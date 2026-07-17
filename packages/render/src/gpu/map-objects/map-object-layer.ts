import { FOG_STATE } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { screenToCell, TILE_HALF_W } from '../../data/iso.js';
import { aabbIntersects, type Viewport } from '../../data/viewport.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import type { TextureCache } from '../texture-cache.js';
import { buildDecorChunk, type DecorChunk, writeObjectQuad } from './decor-batch.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';
import { TallObjectLayer } from './tall-blocks.js';

/**
 * The retained landscape-object layers — a decoded map's placed trees, stones, bushes, mine decals and
 * animated waves, split by whether they occlude a settler:
 *  - **decor** (flat ground decor: waves, grass, flowers, mine stains) batches into per-block meshes
 *    under the entity sprites ({@link import('./decor-batch.js')}), one draw call per texture page per
 *    block, AABB-culled like terrain; an animated decor object's quad is rewritten in place only when
 *    the play-head advances (and only in visible blocks). This layer owns that half directly.
 *  - **tall** (trees, stones — anything that occludes a settler) become pooled sprites in the shared
 *    entity layer, owned by {@link TallObjectLayer}; a member's sprite is minted on first visibility.
 *
 * Built once per map (like the terrain layer): {@link set} buckets the placements by chunk block, builds
 * the decor meshes here, and hands the tall buckets to {@link TallObjectLayer}. The tall sprites live in
 * the renderer's shared `spriteLayer`; the decor meshes live in this layer's own container, which the
 * renderer keeps above the terrain and below the sprites.
 */

/**
 * Decor chunks partition world space into square blocks of this many px — the same scale as the
 * terrain chunks ({@link TERRAIN_CHUNK_TILES}), so the two layers cull in lockstep.
 */
const DECOR_CHUNK_PX = TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

export class MapObjectLayer {
  /** Flat map-object decor (waves, grass, mine stains) — batched meshes above terrain, below sprites. */
  readonly decorContainer = new Container();
  private decorChunks: DecorChunk[] = [];
  /** The tall (settler-occluding) objects — pooled sprites in the shared entity layer. */
  private readonly tall: TallObjectLayer;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer — tall objects attach here so
   *   they interleave with settlers/buildings in one painter order.
   * @param textures the renderer's shared frame→texture cache.
   */
  constructor(spriteLayer: Container, textures: TextureCache) {
    this.tall = new TallObjectLayer(spriteLayer, textures);
  }

  /** (Re)build the retained landscape-object layers from a decoded map's placements — call once per map. */
  set(objects: readonly MapObjectSprite[]): void {
    this.destroy();
    const byBlock = new Map<string, MapObjectSprite[]>();
    const tallByBlock = new Map<string, MapObjectSprite[]>();
    for (const obj of objects) {
      if (obj.frames.length === 0) continue;
      const key = `${Math.floor(obj.x / DECOR_CHUNK_PX)},${Math.floor(obj.y / DECOR_CHUNK_PX)}`;
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
    this.tall.build(tallByBlock);
  }

  /**
   * Take one placed object out of the built layers — the `?map=` handover seam: the moment a virgin
   * resource node is first worked, its static drawing is removed here and the live sprite pool draws
   * the entity from then on. A tall object is removed by {@link TallObjectLayer}; a decor object's quad
   * is zeroed in place (degenerate = invisible; the batch never rebuilds) and, in an animated batch, its
   * slot nulled so the play-head rewrite cannot restore it. O(block members) worst case, and only on the
   * rare first-touch event — never per frame. Unknown objects are a no-op (a placement whose atlas never
   * resolved has nothing drawn).
   */
  remove(obj: MapObjectSprite): void {
    if (this.tall.remove(obj)) return;
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
   * the visible animated batches at the sim tick rate (an off-screen wave costs nothing, a static block
   * is never touched after build); then advance the tall objects ({@link TallObjectLayer.update}).
   *
   * `fogStateOfCell` is the fog-of-war gate over cell coords (the viewer's effective `FOG_STATE`). Flat
   * decor (waves, grass, mine stains) keeps drawing on any non-visible ground (it reads as terrain
   * dressing, which the explored-grey layer shows — the black layer's opaque wash covers it anyway) but
   * its animation freezes there (swaying grass under the fog reads as watched ground), the same
   * memory-not-live-feed rule the tall objects follow.
   */
  update(vp: Viewport, tick: number, fogStateOfCell?: (cellX: number, cellY: number) => number): void {
    // Landscape decor: the written tick is tracked per chunk so a chunk scrolled into view mid-tick
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
          // Animated decor (waves, swaying grass/bushes) freezes on ground the viewer does not
          // currently watch, decided per object cell (the loop rewrites every on-screen animated
          // quad each tick anyway, so a frozen quad just re-writes its fixed-clock frame — no state).
          const cell = screenToCell(obj.x, obj.y);
          const watched =
            fogStateOfCell === undefined || fogStateOfCell(cell.col, cell.row) === FOG_STATE.VISIBLE;
          const frame = objectFrameAt(obj, watched ? tick : 0);
          if (frame !== undefined) {
            writeObjectQuad(batch.positions, batch.uvs, q, obj, frame, batch.pageW, batch.pageH);
          }
        }
        batch.geometry.getBuffer('aPosition').update();
        batch.geometry.getBuffer('aUV').update();
      }
    }
    this.tall.update(vp, tick, fogStateOfCell);
  }

  /** Free the decor meshes + tall-object sprites (a map change re-invalidates both). */
  destroy(): void {
    for (const chunk of this.decorChunks) {
      // A shaded decor mesh's geometry + custom shader aren't freed by Mesh.destroy — release them first.
      destroyMeshChildren(chunk.container);
      chunk.container.destroy({ children: true });
    }
    this.decorChunks = [];
    this.tall.destroy();
  }
}
