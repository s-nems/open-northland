import { FOG_STATE } from '@vinland/sim';
import { Container, Mesh, Sprite } from 'pixi.js';
import { scaleColour } from '../../data/brightness.js';
import { fogGhostTint } from '../../data/fog.js';
import { depthKey, TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';
import { aabbIntersects, isVisible, type Viewport } from '../../data/viewport.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import { buildDecorChunk, type DecorChunk, writeObjectQuad } from './decor-batch.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';

/**
 * The retained landscape-object layers — a decoded map's placed trees, stones, bushes, mine decals and
 * animated waves, split by whether they occlude a settler:
 *  - **decor** (flat ground decor: waves, grass, flowers, mine stains) batches into per-block meshes
 *    UNDER the entity sprites ({@link import('./decor-batch.js')}), one draw call per texture page per
 *    block, AABB-culled like terrain; an animated decor object's quad is rewritten in place only when
 *    the play-head advances (and only in visible blocks).
 *  - **tall** (trees, stones — anything that occludes a settler) become pooled sprites in the shared
 *    ENTITY layer, depth-sorted against settlers/buildings by their world-`y` feet anchor and
 *    viewport-culled each frame; a member's sprite is minted on FIRST visibility (a big map holds
 *    10k–270k tall objects, most of which never scroll into view).
 *
 * Built ONCE per map (like the terrain layer). The tall sprites live in the renderer's shared
 * `spriteLayer` so they interleave with entities in one painter order; the decor meshes live in this
 * layer's own container, which the renderer keeps above the terrain and below the sprites.
 */

/** One tall (non-decor) map object: its static draw data + a LAZILY-minted pooled sprite. */
interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Minted on first visibility (a big map holds 10k–270k tall objects; most never scroll into view). */
  sprite: Sprite | null;
  attached: boolean;
  /** The sprite's undimmed tint (the baked-shading multiplier, or white) — computed at mint so the
   *  per-frame fog grading is a pick between two cached colours, never a recompute. */
  baseTint: number;
  /** {@link import('../../data/fog.js').fogGhostTint} of {@link baseTint} — the explored-ground dim. */
  ghostTint: number;
  /** Whether the last bound frame was picked on the LIVE clock (visible ground) or the frozen one
   *  (a ghosted, explored-only object) — a state flip rebinds once even mid-animation-tick. */
  lastWatched: boolean;
}

/**
 * One block of tall map objects, AABB-culled as a whole before its members are point-tested — the
 * per-frame cull cost tracks the SCREEN (visible blocks), not the map (the render contract; a
 * whole-map flat scan would be an O(objects) loop per frame on maps with 10k–270k trees).
 */
interface TallBlock {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly objects: PooledObject[];
  /** How many members are currently attached — lets an off-screen block skip its detach scan. */
  attachedCount: number;
}

/**
 * Decor chunks partition world space into square blocks of this many px — the SAME scale as the
 * terrain chunks ({@link TERRAIN_CHUNK_TILES}), so the two layers cull in lockstep. Read LIVE (not an
 * import-time const) so a runtime {@link import('../../data/iso.js').setTilePitch} override (`?pitch=`)
 * keeps the decor cull aligned with the terrain instead of the boot-time pitch.
 */
const decorChunkPx = (): number => TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

export class MapObjectLayer {
  /** Flat map-object decor (waves, grass, mine stains) — batched meshes above terrain, below sprites. */
  readonly decorContainer = new Container();
  private decorChunks: DecorChunk[] = [];
  /** Tall map objects (trees, stones) in AABB-culled blocks; sprites minted lazily on first view. */
  private tallBlocks: TallBlock[] = [];
  /** Removal handle per TALL object — which block holds it (see {@link remove}). */
  private tallBlockByObject = new Map<MapObjectSprite, TallBlock>();
  /** The animation tick the tall-object frames were last refreshed for. */
  private lastAnimTick = -1;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer — tall objects attach HERE so
   *   they interleave with settlers/buildings in one painter order.
   * @param textures the renderer's shared frame→texture cache.
   */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
  ) {}

  /**
   * (Re)build the retained landscape-object layers from a decoded map's placements — call ONCE per
   * map. Decor objects batch into per-block meshes under the entity sprites (one draw call per texture
   * page per block, AABB-culled); tall objects become pooled sprites in the ENTITY layer, depth-sorted
   * against settlers/buildings by their world-`y` feet anchor and viewport-culled each frame.
   */
  set(objects: readonly MapObjectSprite[]): void {
    this.destroy();
    const byBlock = new Map<string, MapObjectSprite[]>();
    const tallByBlock = new Map<string, MapObjectSprite[]>();
    for (const obj of objects) {
      if (obj.frames.length === 0) continue;
      const chunkPx = decorChunkPx();
      const key = `${Math.floor(obj.x / chunkPx)},${Math.floor(obj.y / chunkPx)}`;
      const buckets = obj.decor ? byBlock : tallByBlock;
      let block = buckets.get(key);
      if (block === undefined) {
        block = [];
        buckets.set(key, block);
      }
      block.push(obj);
    }
    for (const block of byBlock.values()) {
      const chunk = buildDecorChunk(block);
      this.decorContainer.addChild(chunk.container);
      this.decorChunks.push(chunk);
    }
    for (const block of tallByBlock.values()) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const obj of block) {
        // The block box only needs to cover the feet ANCHORS (the per-object cull is a point test
        // against the margin-inflated viewport, same convention as the entity cull).
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x);
        maxY = Math.max(maxY, obj.y);
      }
      const tall: TallBlock = {
        minX,
        minY,
        maxX,
        maxY,
        objects: block.map((obj) => ({
          obj,
          sprite: null,
          attached: false,
          baseTint: 0xffffff,
          ghostTint: 0xffffff,
          lastWatched: true,
        })),
        attachedCount: 0,
      };
      this.tallBlocks.push(tall);
      for (const obj of block) this.tallBlockByObject.set(obj, tall);
    }
  }

  /**
   * Take ONE placed object out of the built layers — the `?map=` handover seam: the moment a virgin
   * resource node is first worked, its static drawing is removed here and the live sprite pool draws
   * the entity from then on. A TALL object's pooled sprite is detached + destroyed and its member
   * dropped from the block; a DECOR object's quad is zeroed in place (degenerate = invisible; the
   * batch never rebuilds) and, in an animated batch, its slot nulled so the play-head rewrite cannot
   * restore it. O(block members) worst case, and only on the rare first-touch event — never per frame.
   * Unknown objects are a no-op (a placement whose atlas never resolved has nothing drawn).
   */
  remove(obj: MapObjectSprite): void {
    const block = this.tallBlockByObject.get(obj);
    if (block !== undefined) {
      this.tallBlockByObject.delete(obj);
      const i = block.objects.findIndex((po) => po.obj === obj);
      if (i >= 0) {
        const po = block.objects[i] as PooledObject;
        if (po.attached && po.sprite !== null) {
          this.spriteLayer.removeChild(po.sprite);
          block.attachedCount--;
        }
        po.sprite?.destroy();
        block.objects.splice(i, 1);
      }
      return;
    }
    for (const chunk of this.decorChunks) {
      const quad = chunk.quads.get(obj);
      if (quad === undefined) continue;
      chunk.quads.delete(obj);
      quad.positions.fill(0, quad.quadIndex * 8, quad.quadIndex * 8 + 8); // degenerate quad → invisible
      quad.geometry.getBuffer('aPosition').update();
      if (quad.animated !== null) quad.animated.objects[quad.quadIndex] = null; // rewrite loop skips it
      return;
    }
  }

  /**
   * Advance the landscape objects for one frame: cull the decor blocks like terrain and rewrite only
   * the VISIBLE animated batches at the sim tick rate (an off-screen wave costs nothing, a static block
   * is never touched after build); then block-cull the tall objects and per-member point-test them,
   * minting a sprite on first visibility and depth-sorting it against entities by its feet anchor.
   *
   * `fogStateOfCell` is the fog-of-war gate over CELL coords (the viewer's effective `FOG_STATE`): a
   * TALL object (a tree/stone — a strategic resource) on UNEXPLORED ground is treated exactly like a
   * viewport-culled one (detached, kept pooled for when the fog lifts); on EXPLORED ground it draws
   * DIMMED to the ghost grading with its animation FROZEN (a ghost is a memory, not a live feed) —
   * a virgin map object never changes until first worked (the handover
   * removes it here at that moment), so the real object IS its own last-seen ghost, and RECON's
   * known-terrain view shows the map's resources from the start for free. Flat DECOR (waves, grass,
   * mine stains) keeps DRAWING on any non-visible ground (it reads as terrain dressing, which the
   * explored-grey layer shows — the black layer's opaque wash covers it anyway) but its animation
   * freezes there like the tall objects' (swaying grass under the fog reads as watched ground).
   */
  update(vp: Viewport, tick: number, fogStateOfCell?: (cellX: number, cellY: number) => number): void {
    // Landscape decor: the written tick is tracked PER CHUNK so a chunk scrolled into view mid-tick
    // (or while paused) still catches up to the current frame.
    for (const chunk of this.decorChunks) {
      const visible = aabbIntersects(vp, chunk);
      chunk.container.visible = visible;
      if (!visible || chunk.animated.length === 0 || chunk.lastWrittenTick === tick) continue;
      chunk.lastWrittenTick = tick;
      for (const batch of chunk.animated) {
        for (let q = 0; q < batch.objects.length; q++) {
          const obj = batch.objects[q];
          if (obj === null || obj === undefined) continue; // removed (handed to the sprite pool) — stays zeroed
          // Animated decor (waves, swaying grass/bushes) FREEZES on ground the viewer does not
          // currently watch — same memory-not-live-feed rule as the tall objects, decided per
          // object cell (the loop rewrites every on-screen animated quad each tick anyway, so a
          // frozen quad just keeps re-writing its fixed-clock frame — no per-object state).
          const watched =
            fogStateOfCell === undefined ||
            fogStateOfCell(Math.floor(obj.x / (2 * TILE_HALF_W)), Math.floor(obj.y / TILE_HALF_H)) ===
              FOG_STATE.VISIBLE;
          const frame = objectFrameAt(obj, watched ? tick : 0);
          if (frame !== undefined) {
            writeObjectQuad(batch.positions, batch.uvs, q, obj, frame, batch.pageW, batch.pageH);
          }
        }
        batch.geometry.getBuffer('aPosition').update();
        batch.geometry.getBuffer('aUV').update();
      }
    }
    // Tall objects (trees/stones): block-culled, then per-member point-tested against the (already
    // margin-inflated) viewport — the scan cost tracks the visible blocks, not the map. A member's
    // sprite is minted on FIRST visibility (most of a big map's trees never scroll into view) and
    // depth-sorted against entities by its feet anchor (the same world-`y` key the entity containers
    // use); its texture is refreshed only on attach or an animation-tick advance.
    const animAdvanced = tick !== this.lastAnimTick;
    for (const block of this.tallBlocks) {
      const blockVisible = aabbIntersects(vp, block);
      if (!blockVisible) {
        if (block.attachedCount > 0) {
          for (const po of block.objects) {
            if (po.attached && po.sprite !== null) {
              this.spriteLayer.removeChild(po.sprite);
              po.attached = false;
            }
          }
          block.attachedCount = 0;
        }
        continue;
      }
      for (const po of block.objects) {
        const obj = po.obj;
        // The anchor's visual cell — tall objects sit on half-cell nodes (`halfCellToScreen`), so the
        // exact inverse is `⌊x / cellWidth⌋, ⌊y / rowStep⌋` (cell (c,r) owns nodes 2c..2c+1 × 2r..2r+1).
        const fogState =
          fogStateOfCell === undefined
            ? FOG_STATE.VISIBLE
            : fogStateOfCell(Math.floor(obj.x / (2 * TILE_HALF_W)), Math.floor(obj.y / TILE_HALF_H));
        const visible = isVisible(vp, obj.x, obj.y) && fogState !== FOG_STATE.UNEXPLORED;
        if (!visible) {
          if (po.attached && po.sprite !== null) {
            this.spriteLayer.removeChild(po.sprite);
            po.attached = false;
            block.attachedCount--;
          }
          continue;
        }
        if (po.sprite === null) {
          po.sprite = new Sprite();
          po.sprite.scale.set(obj.scale);
          po.sprite.zIndex = depthKey(obj.x, obj.y); // static — set once
          // Baked-shading multiplier as a grey tint (stones on a dark slope darken with the ground).
          // A batch tint cannot brighten, so the lane's >1 half clamps at ×1 — a named approximation
          // (see MapObjectSprite.brightness); the app omits the field for the full-bright kinds (trees).
          po.baseTint = obj.brightness !== undefined ? scaleColour(0xffffff, obj.brightness) : 0xffffff;
          po.ghostTint = fogGhostTint(po.baseTint);
        }
        // Explored-but-unwatched ground dims the object to the ghost grading; re-assigned per frame
        // (a pick between two cached colours — Pixi's tint setter no-ops on an unchanged value).
        // UNEXPLORED never reaches here (detached above), so VISIBLE is the one live state.
        const watched = fogState === FOG_STATE.VISIBLE;
        po.sprite.tint = watched ? po.baseTint : po.ghostTint;
        // A ghosted object's animation FREEZES (a memory, not a live feed — swaying trees under the
        // fog read as watched ground): unwatched frames bind at a fixed clock, live ones advance;
        // a watched↔ghosted flip rebinds once so the pose switches with the tint.
        if (
          !po.attached ||
          watched !== po.lastWatched ||
          (watched && animAdvanced && obj.frames.length > 1)
        ) {
          const frame = objectFrameAt(obj, watched ? tick : 0);
          if (frame === undefined) continue;
          po.sprite.texture = this.textures.get(obj.source, frame);
          // Draw at the lifted feet; the zIndex above kept the pre-lift `obj.y` so depth is by map row.
          po.sprite.position.set(
            obj.x + frame.offsetX * obj.scale,
            obj.y - (obj.lift ?? 0) + frame.offsetY * obj.scale,
          );
        }
        po.lastWatched = watched;
        if (!po.attached) {
          this.spriteLayer.addChild(po.sprite);
          po.attached = true;
          block.attachedCount++;
        }
      }
    }
    this.lastAnimTick = tick;
  }

  /** Free the decor meshes + tall-object sprites (a map change re-invalidates both). */
  destroy(): void {
    for (const chunk of this.decorChunks) {
      for (const child of chunk.container.children) {
        if (child instanceof Mesh) {
          child.geometry.destroy();
          // A shaded decor mesh owns a per-mesh Shader (custom shaders aren't freed by Mesh.destroy;
          // the compiled GL program is shared process-wide and deliberately kept).
          child.shader?.destroy();
        }
      }
      chunk.container.destroy({ children: true });
    }
    this.decorChunks = [];
    for (const block of this.tallBlocks) {
      for (const po of block.objects) po.sprite?.destroy();
    }
    this.tallBlocks = [];
    this.tallBlockByObject.clear();
    this.lastAnimTick = -1;
  }
}
