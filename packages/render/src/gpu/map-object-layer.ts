import { Container, Mesh, MeshGeometry, Sprite, Texture, type TextureSource } from 'pixi.js';
import { TILE_HALF_W, depthKey } from '../data/iso.js';
import type { AtlasFrame } from '../data/sprites.js';
import { type Viewport, aabbIntersects, isVisible } from '../data/viewport.js';
import { TERRAIN_CHUNK_TILES } from './terrain-layer.js';
import type { TextureCache } from './texture-cache.js';

/**
 * The retained landscape-object layers — a decoded map's placed trees, stones, bushes, mine decals and
 * animated waves, split by whether they occlude a settler:
 *  - **decor** (flat ground decor: waves, grass, flowers, mine stains) batches into per-block meshes
 *    UNDER the entity sprites, one draw call per texture page per block, AABB-culled like terrain; an
 *    animated decor object's quad is rewritten in place only when the play-head advances (and only in
 *    visible blocks).
 *  - **tall** (trees, stones — anything that occludes a settler) become pooled sprites in the shared
 *    ENTITY layer, depth-sorted against settlers/buildings by their world-`y` feet anchor and
 *    viewport-culled each frame; a member's sprite is minted on FIRST visibility (a big map holds
 *    10k–270k tall objects, most of which never scroll into view).
 *
 * Built ONCE per map (like the terrain layer). The tall sprites live in the renderer's shared
 * `spriteLayer` so they interleave with entities in one painter order; the decor meshes live in this
 * layer's own container, which the renderer keeps above the terrain and below the sprites.
 */

/**
 * One placed landscape object, fully resolved by the app (atlas source + frame list + position):
 * a tree, stone, bush, mine decal or animated wave from a decoded map's `objects` layer. `frames`
 * with more than one entry is a looping animation played from {@link phase} (the app sets phase 0
 * everywhere — the wave bobs tile seamlessly only when neighbours show the SAME frame). `decor`
 * objects are flat ground decor (waves, grass, flowers, mine stains): they batch into per-chunk
 * meshes UNDER the entity sprites; non-decor (tall) objects (trees, stones) depth-sort against
 * entities by their world-`y` feet anchor.
 */
export interface MapObjectSprite {
  /** World-space feet anchor (px), already projected by the app (`halfCellToScreen` of the `emla` half-cell). */
  readonly x: number;
  readonly y: number;
  readonly source: TextureSource;
  /** The object's frame list (1 = static; >1 = a loop played at the sim tick rate). */
  readonly frames: readonly AtlasFrame[];
  readonly scale: number;
  readonly decor: boolean;
  /** Starting frame offset into {@link frames} (kept for future per-object phase data). */
  readonly phase: number;
  /** Draw opacity (1 = opaque). Waves composite translucently over the water ground. */
  readonly alpha: number;
}

/** One tall (non-decor) map object: its static draw data + a LAZILY-minted pooled sprite. */
interface PooledObject {
  readonly obj: MapObjectSprite;
  /** Minted on first visibility (a big map holds 10k–270k tall objects; most never scroll into view). */
  sprite: Sprite | null;
  attached: boolean;
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
 * One decor chunk: flat map objects batched by texture source into meshes (built once for static
 * objects; animated ones have their vertex/uv buffers rewritten in place when the play-head
 * advances — and only while the chunk is visible). AABB-culled like terrain chunks.
 */
interface DecorChunk {
  readonly container: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Animated batches to rewrite on an anim-tick advance (empty for an all-static chunk). */
  readonly animated: AnimatedDecorBatch[];
  /** The tick the animated buffers were last written for — per chunk, so a chunk scrolling into
   *  view while the sim is paused still gets caught up to the current tick's frame. */
  lastWrittenTick: number;
}

/** One animated decor batch: its mesh buffers + the objects whose quads fill them, in quad order. */
interface AnimatedDecorBatch {
  readonly objects: MapObjectSprite[];
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly geometry: MeshGeometry;
  readonly pageW: number;
  readonly pageH: number;
}

/**
 * Decor chunks partition world space into square blocks of this many px — the SAME scale as the
 * terrain chunks ({@link TERRAIN_CHUNK_TILES}), so the two layers cull in lockstep. Read LIVE (not an
 * import-time const) so a runtime {@link import('../data/iso.js').setTilePitch} override (`?pitch=`)
 * keeps the decor cull aligned with the terrain instead of the boot-time pitch.
 */
const decorChunkPx = (): number => TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;

/** Write one object's current frame as a quad into flat position/uv buffers at `quadIndex`. */
function writeObjectQuad(
  positions: Float32Array | number[],
  uvs: Float32Array | number[],
  quadIndex: number,
  obj: MapObjectSprite,
  frame: AtlasFrame,
  pageW: number,
  pageH: number,
): void {
  const x0 = obj.x + frame.offsetX * obj.scale;
  const y0 = obj.y + frame.offsetY * obj.scale;
  const x1 = x0 + frame.width * obj.scale;
  const y1 = y0 + frame.height * obj.scale;
  const p = quadIndex * 8;
  positions[p] = x0;
  positions[p + 1] = y0;
  positions[p + 2] = x1;
  positions[p + 3] = y0;
  positions[p + 4] = x1;
  positions[p + 5] = y1;
  positions[p + 6] = x0;
  positions[p + 7] = y1;
  const u0 = frame.x / pageW;
  const v0 = frame.y / pageH;
  const u1 = (frame.x + frame.width) / pageW;
  const v1 = (frame.y + frame.height) / pageH;
  uvs[p] = u0;
  uvs[p + 1] = v0;
  uvs[p + 2] = u1;
  uvs[p + 3] = v0;
  uvs[p + 4] = u1;
  uvs[p + 5] = v1;
  uvs[p + 6] = u0;
  uvs[p + 7] = v1;
}

/** The frame an object shows at a given animation tick (static objects always show frame 0). */
function objectFrameAt(obj: MapObjectSprite, tick: number): AtlasFrame | undefined {
  if (obj.frames.length <= 1) return obj.frames[0];
  return obj.frames[(tick + obj.phase) % obj.frames.length];
}

export class MapObjectLayer {
  /** Flat map-object decor (waves, grass, mine stains) — batched meshes above terrain, below sprites. */
  readonly decorContainer = new Container();
  private decorChunks: DecorChunk[] = [];
  /** Tall map objects (trees, stones) in AABB-culled blocks; sprites minted lazily on first view. */
  private tallBlocks: TallBlock[] = [];
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
    for (const block of byBlock.values()) this.decorChunks.push(this.buildDecorChunk(block));
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
      this.tallBlocks.push({
        minX,
        minY,
        maxX,
        maxY,
        objects: block.map((obj) => ({ obj, sprite: null, attached: false })),
        attachedCount: 0,
      });
    }
  }

  /**
   * Advance the landscape objects for one frame: cull the decor blocks like terrain and rewrite only
   * the VISIBLE animated batches at the sim tick rate (an off-screen wave costs nothing, a static block
   * is never touched after build); then block-cull the tall objects and per-member point-test them,
   * minting a sprite on first visibility and depth-sorting it against entities by its feet anchor.
   */
  update(vp: Viewport, tick: number): void {
    // Landscape decor: the written tick is tracked PER CHUNK so a chunk scrolled into view mid-tick
    // (or while paused) still catches up to the current frame.
    for (const chunk of this.decorChunks) {
      const visible = aabbIntersects(vp, chunk);
      chunk.container.visible = visible;
      if (!visible || chunk.animated.length === 0 || chunk.lastWrittenTick === tick) continue;
      chunk.lastWrittenTick = tick;
      for (const batch of chunk.animated) {
        for (let q = 0; q < batch.objects.length; q++) {
          const obj = batch.objects[q] as MapObjectSprite;
          const frame = objectFrameAt(obj, tick);
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
        const visible = isVisible(vp, obj.x, obj.y);
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
          po.sprite.alpha = obj.alpha;
          po.sprite.scale.set(obj.scale);
          po.sprite.zIndex = depthKey(obj.x, obj.y); // static — set once
        }
        if (!po.attached || (animAdvanced && obj.frames.length > 1)) {
          const frame = objectFrameAt(obj, tick);
          if (frame === undefined) continue;
          po.sprite.texture = this.textures.get(obj.source, frame);
          po.sprite.position.set(obj.x + frame.offsetX * obj.scale, obj.y + frame.offsetY * obj.scale);
        }
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
        if (child instanceof Mesh) child.geometry.destroy();
      }
      chunk.container.destroy({ children: true });
    }
    this.decorChunks = [];
    for (const block of this.tallBlocks) {
      for (const po of block.objects) po.sprite?.destroy();
    }
    this.tallBlocks = [];
    this.lastAnimTick = -1;
  }

  /** Batch one decor block: group its objects by texture source into a static and an animated mesh each. */
  private buildDecorChunk(block: readonly MapObjectSprite[]): DecorChunk {
    const container = new Container();
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // Batch key = (source, alpha): quads in one mesh share a texture AND an opacity (mesh.alpha).
    const bySource = new Map<
      string,
      { source: TextureSource; alpha: number; still: MapObjectSprite[]; moving: MapObjectSprite[] }
    >();
    let sourceId = 0;
    const sourceIds = new Map<TextureSource, number>();
    for (const obj of block) {
      let id = sourceIds.get(obj.source);
      if (id === undefined) {
        id = sourceId++;
        sourceIds.set(obj.source, id);
      }
      const key = `${id}:${obj.alpha}`;
      let group = bySource.get(key);
      if (group === undefined) {
        group = { source: obj.source, alpha: obj.alpha, still: [], moving: [] };
        bySource.set(key, group);
      }
      (obj.frames.length > 1 ? group.moving : group.still).push(obj);
      // The AABB covers every frame the object can show (frames differ a little in size/offset).
      for (const frame of obj.frames) {
        minX = Math.min(minX, obj.x + frame.offsetX * obj.scale);
        minY = Math.min(minY, obj.y + frame.offsetY * obj.scale);
        maxX = Math.max(maxX, obj.x + (frame.offsetX + frame.width) * obj.scale);
        maxY = Math.max(maxY, obj.y + (frame.offsetY + frame.height) * obj.scale);
      }
    }
    const animated: AnimatedDecorBatch[] = [];
    for (const group of bySource.values()) {
      const source = group.source;
      if (group.still.length > 0) {
        const positions = new Float32Array(group.still.length * 8);
        const uvs = new Float32Array(group.still.length * 8);
        const indices = new Uint32Array(group.still.length * 6);
        for (let q = 0; q < group.still.length; q++) {
          const obj = group.still[q] as MapObjectSprite;
          writeObjectQuad(positions, uvs, q, obj, obj.frames[0] as AtlasFrame, source.width, source.height);
          indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        }
        const geometry = new MeshGeometry({ positions, uvs, indices });
        const mesh = new Mesh({ geometry, texture: new Texture({ source }) });
        mesh.alpha = group.alpha;
        container.addChild(mesh);
      }
      if (group.moving.length > 0) {
        const positions = new Float32Array(group.moving.length * 8);
        const uvs = new Float32Array(group.moving.length * 8);
        const indices = new Uint32Array(group.moving.length * 6);
        for (let q = 0; q < group.moving.length; q++) {
          const obj = group.moving[q] as MapObjectSprite;
          const frame = objectFrameAt(obj, 0) as AtlasFrame;
          writeObjectQuad(positions, uvs, q, obj, frame, source.width, source.height);
          indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
        }
        const geometry = new MeshGeometry({ positions, uvs, indices });
        const mesh = new Mesh({ geometry, texture: new Texture({ source }) });
        mesh.alpha = group.alpha;
        container.addChild(mesh);
        animated.push({
          objects: group.moving,
          positions,
          uvs,
          geometry,
          pageW: source.width,
          pageH: source.height,
        });
      }
    }
    this.decorContainer.addChild(container);
    // Animated quads were written for tick 0 at build; the first update rewrites any other tick.
    return { container, minX, minY, maxX, maxY, animated, lastWrittenTick: 0 };
  }
}
