import { Container, Mesh, MeshGeometry, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';

/**
 * The DECOR half of the map-object feature: flat ground decor (waves, grass, flowers, mine stains)
 * batched into per-block quad meshes UNDER the entity sprites — one draw call per (texture page,
 * alpha) per block, built once; an animated batch's vertex/uv buffers are rewritten in place when the
 * play-head advances (and only while the block is visible).
 */

/** Write one object's current frame as a quad into flat position/uv buffers at `quadIndex`. */
export function writeObjectQuad(
  positions: Float32Array | number[],
  uvs: Float32Array | number[],
  quadIndex: number,
  obj: MapObjectSprite,
  frame: AtlasFrame,
  pageW: number,
  pageH: number,
): void {
  const x0 = obj.x + frame.offsetX * obj.scale;
  // Lift the drawn quad up the hill (the anchor + depth stay pre-lift; only the draw y moves).
  const y0 = obj.y - (obj.lift ?? 0) + frame.offsetY * obj.scale;
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

/** One built quad-batch mesh + the buffers behind it (the caller keeps the buffers only for an
 *  ANIMATED batch, whose quads are rewritten in place when the play-head advances). */
interface QuadBatch {
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly geometry: MeshGeometry;
}

/** Batch `objects` (all sharing `source` + `alpha`) into ONE mesh of quads, each written for its
 *  tick-0 frame — the shared build step for a decor group's static and animated halves. */
function buildQuadBatch(
  objects: readonly MapObjectSprite[],
  source: TextureSource,
  alpha: number,
): QuadBatch {
  const positions = new Float32Array(objects.length * 8);
  const uvs = new Float32Array(objects.length * 8);
  const indices = new Uint32Array(objects.length * 6);
  for (let q = 0; q < objects.length; q++) {
    const obj = objects[q] as MapObjectSprite;
    const frame = objectFrameAt(obj, 0) as AtlasFrame;
    writeObjectQuad(positions, uvs, q, obj, frame, source.width, source.height);
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  }
  const geometry = new MeshGeometry({ positions, uvs, indices });
  const mesh = new Mesh({ geometry, texture: new Texture({ source }) });
  mesh.alpha = alpha;
  return { mesh, positions, uvs, geometry };
}

/** One animated decor batch: its mesh buffers + the objects whose quads fill them, in quad order. */
export interface AnimatedDecorBatch {
  readonly objects: MapObjectSprite[];
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly geometry: MeshGeometry;
  readonly pageW: number;
  readonly pageH: number;
}

/**
 * One decor chunk: flat map objects batched by texture source into meshes (built once for static
 * objects; animated ones have their vertex/uv buffers rewritten in place when the play-head
 * advances — and only while the chunk is visible). AABB-culled like terrain chunks.
 */
export interface DecorChunk {
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

/** Batch one decor block: group its objects by texture source into a static and an animated mesh each.
 *  The caller owns attaching the returned chunk's container to its layer. */
export function buildDecorChunk(block: readonly MapObjectSprite[]): DecorChunk {
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
      container.addChild(buildQuadBatch(group.still, source, group.alpha).mesh);
    }
    if (group.moving.length > 0) {
      const batch = buildQuadBatch(group.moving, source, group.alpha);
      container.addChild(batch.mesh);
      animated.push({
        objects: group.moving,
        positions: batch.positions,
        uvs: batch.uvs,
        geometry: batch.geometry,
        pageW: source.width,
        pageH: source.height,
      });
    }
  }
  // Animated quads were written for tick 0 at build; the first update rewrites any other tick.
  return { container, minX, minY, maxX, maxY, animated, lastWrittenTick: 0 };
}
