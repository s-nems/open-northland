import { Container, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { makeShadedDecorShader } from '../shading.js';
import { SHADOW_BLUR_PADDING } from '../soft-shadow-cache.js';
import { type DecorShadowUniforms, makeDecorShadowShader } from './decor-shadow-shader.js';
import { type MapObjectSprite, objectFrameAt, objectFrameIndexAt } from './map-object-sprite.js';

/**
 * Flat ground decor batched into per-block quad meshes, one draw call per texture page per block, split
 * static/animated. Translucency rides in the atlas texture's own alpha channel; there is no per-object
 * opacity. An object's cast shadow batches the same way from its silhouette page, into a container the
 * layer draws under every decor body, in quads the soft edge's reach wider than their frames.
 */

/** Which of an object's two index-paired frame lists a batch draws. */
type DecorLane = 'body' | 'shadow';

function laneSource(obj: MapObjectSprite, lane: DecorLane): TextureSource | undefined {
  return lane === 'body' ? obj.source : obj.shadow?.source;
}

/** `undefined` on the shadow lane is a pose that casts no silhouette. */
function laneFrameAt(obj: MapObjectSprite, lane: DecorLane, tick: number): AtlasFrame | undefined {
  return lane === 'body' ? objectFrameAt(obj, tick) : obj.shadow?.frames[objectFrameIndexAt(obj, tick)];
}

/** Source pixels a lane's quad extends past its frame on every side. */
function laneMargin(lane: DecorLane): number {
  return lane === 'shadow' ? SHADOW_BLUR_PADDING : 0;
}

const FLOATS_PER_QUAD = 8;
const VERTICES_PER_QUAD = 4;
/** `aFrame` is a vec4 per vertex: the frame's min and max texel corner. */
const FRAME_BOUND_FLOATS = 4;
const FRAME_FLOATS_PER_QUAD = FRAME_BOUND_FLOATS * VERTICES_PER_QUAD;

/** What a quad write fills: a batch's buffers, and the page size its UVs divide by. `frameBounds`
 *  exists on the shadow lane only. */
interface QuadBuffers {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly frameBounds: Float32Array | null;
  readonly pageW: number;
  readonly pageH: number;
}

function writeObjectQuad(
  buffers: QuadBuffers,
  quadIndex: number,
  obj: MapObjectSprite,
  frame: AtlasFrame,
  margin: number,
): void {
  const { positions, uvs, frameBounds, pageW, pageH } = buffers;
  const x0 = obj.x + (frame.offsetX - margin) * obj.scale;
  // Only the draw y moves; the anchor and depth stay pre-lift.
  const y0 = obj.y - (obj.lift ?? 0) + (frame.offsetY - margin) * obj.scale;
  const x1 = x0 + (frame.width + margin * 2) * obj.scale;
  const y1 = y0 + (frame.height + margin * 2) * obj.scale;
  const p = quadIndex * FLOATS_PER_QUAD;
  positions[p] = x0;
  positions[p + 1] = y0;
  positions[p + 2] = x1;
  positions[p + 3] = y0;
  positions[p + 4] = x1;
  positions[p + 5] = y1;
  positions[p + 6] = x0;
  positions[p + 7] = y1;
  const u0 = (frame.x - margin) / pageW;
  const v0 = (frame.y - margin) / pageH;
  const u1 = (frame.x + frame.width + margin) / pageW;
  const v1 = (frame.y + frame.height + margin) / pageH;
  uvs[p] = u0;
  uvs[p + 1] = v0;
  uvs[p + 2] = u1;
  uvs[p + 3] = v0;
  uvs[p + 4] = u1;
  uvs[p + 5] = v1;
  uvs[p + 6] = u0;
  uvs[p + 7] = v1;
  if (frameBounds === null) return;
  for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex++) {
    const b = quadIndex * FRAME_FLOATS_PER_QUAD + vertex * FRAME_BOUND_FLOATS;
    frameBounds[b] = frame.x;
    frameBounds[b + 1] = frame.y;
    frameBounds[b + 2] = frame.x + frame.width;
    frameBounds[b + 3] = frame.y + frame.height;
  }
}

/** One built quad-batch mesh plus the buffers behind it; only an animated batch's caller keeps the
 *  buffers, to rewrite its quads in place when the play-head advances. */
interface QuadBatch {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  readonly buffers: QuadBuffers;
  readonly geometry: MeshGeometry;
}

/** Batch `objects`, which all share `source` on `lane`, into one mesh of quads written for their tick-0
 *  frame. A body batch with any per-object brightness draws through the shaded ground shader, with the
 *  multiplier constant across a quad's four vertices so an animated rewrite never touches it. */
function buildQuadBatch(
  objects: readonly MapObjectSprite[],
  source: TextureSource,
  lane: DecorLane,
  shadowStyle: DecorShadowUniforms,
): QuadBatch {
  const buffers: QuadBuffers = {
    positions: new Float32Array(objects.length * FLOATS_PER_QUAD),
    uvs: new Float32Array(objects.length * FLOATS_PER_QUAD),
    frameBounds: lane === 'shadow' ? new Float32Array(objects.length * FRAME_FLOATS_PER_QUAD) : null,
    pageW: source.width,
    pageH: source.height,
  };
  const indices = new Uint32Array(objects.length * 6);
  const shaded = lane === 'body' && objects.some((obj) => obj.brightness !== undefined);
  const brightness = shaded ? new Float32Array(objects.length * 4) : null;
  for (let q = 0; q < objects.length; q++) {
    // Indexed whatever the pose holds: a quad without a frame stays degenerate until a rewrite fills it.
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    const obj = objects[q];
    const frame = obj === undefined ? undefined : laneFrameAt(obj, lane, 0);
    if (obj === undefined || frame === undefined) continue;
    writeObjectQuad(buffers, q, obj, frame, laneMargin(lane));
    brightness?.fill(obj.brightness ?? 1, q * 4, q * 4 + 4);
  }
  const geometry = new MeshGeometry({ positions: buffers.positions, uvs: buffers.uvs, indices });
  if (brightness !== null) geometry.addAttribute('aBrightness', { buffer: brightness });
  if (buffers.frameBounds !== null) geometry.addAttribute('aFrame', { buffer: buffers.frameBounds });
  // A mesh with a shader of its own never reads a texture, so only the plain batch mints one.
  let mesh: Mesh<MeshGeometry, Shader>;
  if (lane === 'shadow') mesh = new Mesh({ geometry, shader: makeDecorShadowShader(source, shadowStyle) });
  else if (brightness !== null) mesh = new Mesh({ geometry, shader: makeShadedDecorShader(source) });
  else mesh = new Mesh({ geometry, texture: new Texture({ source }) });
  return { mesh, buffers, geometry };
}

/** One animated decor batch: its mesh buffers + the objects whose quads fill them, in quad order.
 *  A removed object's slot is `null` - its quad stays zeroed and the rewrite loop skips it. */
export interface AnimatedDecorBatch {
  readonly lane: DecorLane;
  readonly objects: (MapObjectSprite | null)[];
  readonly buffers: QuadBuffers;
  readonly geometry: MeshGeometry;
}

/** Rewrite quad `q` of an animated batch for `tick`; a pose without a frame collapses the quad. */
export function writeAnimatedQuad(
  batch: AnimatedDecorBatch,
  q: number,
  obj: MapObjectSprite,
  tick: number,
): void {
  const frame = laneFrameAt(obj, batch.lane, tick);
  if (frame === undefined) {
    batch.buffers.positions.fill(0, q * FLOATS_PER_QUAD, (q + 1) * FLOATS_PER_QUAD);
    return;
  }
  writeObjectQuad(batch.buffers, q, obj, frame, laneMargin(batch.lane));
}

/** Upload an animated batch's rewritten quads. */
export function uploadAnimatedBatch(batch: AnimatedDecorBatch): void {
  batch.geometry.getBuffer('aPosition').update();
  batch.geometry.getBuffer('aUV').update();
  if (batch.buffers.frameBounds !== null) batch.geometry.getBuffer('aFrame').update();
}

/** Where one quad of a decor object lives. */
interface DecorQuadRef {
  readonly positions: Float32Array;
  readonly geometry: MeshGeometry;
  readonly quadIndex: number;
  /** The rewrite batch the quad belongs to, or null for a still (never-rewritten) batch. */
  readonly animated: AnimatedDecorBatch | null;
}

/** Collapse a quad for good: zeroed in place, and dropped from its batch's rewrite loop. */
export function retireDecorQuad(quad: DecorQuadRef): void {
  quad.positions.fill(0, quad.quadIndex * FLOATS_PER_QUAD, (quad.quadIndex + 1) * FLOATS_PER_QUAD);
  quad.geometry.getBuffer('aPosition').update();
  if (quad.animated !== null) quad.animated.objects[quad.quadIndex] = null;
}

/** A decor object's quads: its body, and its cast shadow when it carries one. */
interface DecorObjectQuads {
  readonly body: DecorQuadRef;
  shadow: DecorQuadRef | null;
}

/**
 * One decor chunk: flat map objects batched by texture source into meshes, AABB-culled like terrain
 * chunks. Static batches are built once; an animated batch's buffers are rewritten in place when the
 * play-head advances, and only while the chunk is visible.
 */
export interface DecorChunk {
  readonly container: Container;
  /** The chunk's cast shadows, mounted apart so they sit under the bodies of every chunk. */
  readonly shadowContainer: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Animated batches to rewrite on an anim-tick advance (empty for an all-static chunk). */
  readonly animated: AnimatedDecorBatch[];
  readonly quads: Map<MapObjectSprite, DecorObjectQuads>;
  /** The tick the animated buffers were last written for. Per chunk, so a chunk scrolling into view
   *  while the sim is paused still catches up to the current tick's frame. */
  lastWrittenTick: number;
}

/** Batch one lane of a block into `container`, a still and an animated mesh per texture source (quads in
 *  one mesh share a page; opacity is per pixel, in the page). Reports each object's quad to `placed`. */
function buildLane(
  block: readonly MapObjectSprite[],
  lane: DecorLane,
  container: Container,
  shadowStyle: DecorShadowUniforms,
  animated: AnimatedDecorBatch[],
  placed: (obj: MapObjectSprite, quad: DecorQuadRef) => void,
): void {
  const bySource = new Map<TextureSource, { still: MapObjectSprite[]; moving: MapObjectSprite[] }>();
  for (const obj of block) {
    const source = laneSource(obj, lane);
    if (source === undefined) continue;
    let group = bySource.get(source);
    if (group === undefined) {
      group = { still: [], moving: [] };
      bySource.set(source, group);
    }
    (obj.frames.length > 1 ? group.moving : group.still).push(obj);
  }
  for (const [source, group] of bySource) {
    for (const objects of [group.still, group.moving]) {
      if (objects.length === 0) continue;
      const batch = buildQuadBatch(objects, source, lane, shadowStyle);
      container.addChild(batch.mesh);
      let animBatch: AnimatedDecorBatch | null = null;
      if (objects === group.moving) {
        animBatch = { lane, objects, buffers: batch.buffers, geometry: batch.geometry };
        animated.push(animBatch);
      }
      for (const [q, obj] of objects.entries()) {
        placed(obj, {
          positions: batch.buffers.positions,
          geometry: batch.geometry,
          quadIndex: q,
          animated: animBatch,
        });
      }
    }
  }
}

/** Batch one decor block. The caller owns attaching the returned chunk's containers to its layers. */
export function buildDecorChunk(
  block: readonly MapObjectSprite[],
  shadowStyle: DecorShadowUniforms,
): DecorChunk {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const obj of block) {
    // The AABB covers every frame the object can show (frames differ a little in size/offset), its
    // silhouettes included.
    const lanes: readonly [DecorLane, readonly (AtlasFrame | undefined)[]][] = [
      ['body', obj.frames],
      ['shadow', obj.shadow?.frames ?? []],
    ];
    for (const [lane, frames] of lanes) {
      const margin = laneMargin(lane);
      for (const frame of frames) {
        if (frame === undefined) continue;
        minX = Math.min(minX, obj.x + (frame.offsetX - margin) * obj.scale);
        minY = Math.min(minY, obj.y + (frame.offsetY - margin) * obj.scale);
        maxX = Math.max(maxX, obj.x + (frame.offsetX + frame.width + margin) * obj.scale);
        maxY = Math.max(maxY, obj.y + (frame.offsetY + frame.height + margin) * obj.scale);
      }
    }
  }
  const container = new Container();
  const shadowContainer = new Container();
  const animated: AnimatedDecorBatch[] = [];
  const quads = new Map<MapObjectSprite, DecorObjectQuads>();
  buildLane(block, 'body', container, shadowStyle, animated, (obj, body) => {
    quads.set(obj, { body, shadow: null });
  });
  buildLane(block, 'shadow', shadowContainer, shadowStyle, animated, (obj, shadow) => {
    const placed = quads.get(obj);
    if (placed !== undefined) placed.shadow = shadow;
  });
  // Animated quads were written for tick 0 at build; the first update rewrites any other tick.
  return { container, shadowContainer, minX, minY, maxX, maxY, animated, quads, lastWrittenTick: 0 };
}
