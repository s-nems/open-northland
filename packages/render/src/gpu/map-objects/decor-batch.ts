import { Container, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { makeShadedDecorShader } from '../shading.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';

/**
 * The DECOR half of the map-object feature: flat ground decor (waves, grass, flowers, mine stains)
 * batched into per-block quad meshes UNDER the entity sprites — one draw call per texture page per
 * block, built once; an animated batch's vertex/uv buffers are rewritten in place when the play-head
 * advances (and only while the block is visible). Translucency (waves, fern edges) rides in the atlas
 * texture's own alpha channel — there is no per-object opacity.
 *
 * On a brightness-shaded map ({@link MapObjectSprite.brightness}) each quad carries its anchor
 * cell's multiplier as a constant per-vertex `aBrightness` (the ground's shaded-mesh shader — same
 * one-draw-call batching, full >1 range), because the original bakes the `embr` shading into these
 * ground-coupled decals too (measured on the corpus — see the field's doc).
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
  readonly mesh: Mesh<MeshGeometry, Shader>;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly geometry: MeshGeometry;
}

/** Batch `objects` (all sharing `source`) into ONE mesh of quads, each written for its
 *  tick-0 frame — the shared build step for a decor group's static and animated halves. A batch with
 *  any per-object brightness draws through the shaded ground shader, each quad's four vertices
 *  carrying its anchor cell's multiplier (constant per quad, so an animated rewrite never touches it). */
function buildQuadBatch(objects: readonly MapObjectSprite[], source: TextureSource): QuadBatch {
  const positions = new Float32Array(objects.length * 8);
  const uvs = new Float32Array(objects.length * 8);
  const indices = new Uint32Array(objects.length * 6);
  const shaded = objects.some((obj) => obj.brightness !== undefined);
  const brightness = shaded ? new Float32Array(objects.length * 4) : null;
  for (let q = 0; q < objects.length; q++) {
    const obj = objects[q] as MapObjectSprite;
    const frame = objectFrameAt(obj, 0) as AtlasFrame;
    writeObjectQuad(positions, uvs, q, obj, frame, source.width, source.height);
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    brightness?.fill(obj.brightness ?? 1, q * 4, q * 4 + 4);
  }
  const geometry = new MeshGeometry({ positions, uvs, indices });
  if (brightness !== null) geometry.addAttribute('aBrightness', { buffer: brightness });
  const mesh =
    brightness !== null
      ? new Mesh({ geometry, texture: new Texture({ source }), shader: makeShadedDecorShader(source) })
      : new Mesh({ geometry, texture: new Texture({ source }) });
  return { mesh, positions, uvs, geometry };
}

/** One animated decor batch: its mesh buffers + the objects whose quads fill them, in quad order.
 *  A REMOVED object's slot is `null` — its quad stays zeroed and the rewrite loop skips it. */
interface AnimatedDecorBatch {
  readonly objects: (MapObjectSprite | null)[];
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly geometry: MeshGeometry;
  readonly pageW: number;
  readonly pageH: number;
}

/** Where ONE decor object's quad lives — the removal handle {@link DecorChunk.quads} hands the layer:
 *  zero the 8 floats at `quadIndex` (+ buffer update) and, for an animated batch, null its slot so the
 *  play-head rewrite never restores it. */
interface DecorQuadRef {
  readonly positions: Float32Array;
  readonly geometry: MeshGeometry;
  readonly quadIndex: number;
  /** The rewrite batch the quad belongs to, or null for a still (never-rewritten) batch. */
  readonly animated: AnimatedDecorBatch | null;
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
  /** Per-object removal handles (see {@link DecorQuadRef}) — how the layer takes ONE quad out of a
   *  built batch when a virgin map resource is first worked (the `?map=` handover). */
  readonly quads: Map<MapObjectSprite, DecorQuadRef>;
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
  // Batch key = the texture source: quads in one mesh share a page (opacity is per pixel, in the page).
  const bySource = new Map<TextureSource, { still: MapObjectSprite[]; moving: MapObjectSprite[] }>();
  for (const obj of block) {
    let group = bySource.get(obj.source);
    if (group === undefined) {
      group = { still: [], moving: [] };
      bySource.set(obj.source, group);
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
  const quads = new Map<MapObjectSprite, DecorQuadRef>();
  for (const [source, group] of bySource) {
    if (group.still.length > 0) {
      const batch = buildQuadBatch(group.still, source);
      container.addChild(batch.mesh);
      for (let q = 0; q < group.still.length; q++) {
        const obj = group.still[q] as MapObjectSprite;
        quads.set(obj, {
          positions: batch.positions,
          geometry: batch.geometry,
          quadIndex: q,
          animated: null,
        });
      }
    }
    if (group.moving.length > 0) {
      const batch = buildQuadBatch(group.moving, source);
      container.addChild(batch.mesh);
      const animBatch: AnimatedDecorBatch = {
        objects: group.moving,
        positions: batch.positions,
        uvs: batch.uvs,
        geometry: batch.geometry,
        pageW: source.width,
        pageH: source.height,
      };
      animated.push(animBatch);
      for (let q = 0; q < group.moving.length; q++) {
        const obj = group.moving[q] as MapObjectSprite;
        quads.set(obj, {
          positions: batch.positions,
          geometry: batch.geometry,
          quadIndex: q,
          animated: animBatch,
        });
      }
    }
  }
  // Animated quads were written for tick 0 at build; the first update rewrites any other tick.
  return { container, minX, minY, maxX, maxY, animated, quads, lastWrittenTick: 0 };
}
