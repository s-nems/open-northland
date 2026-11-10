import { FOG_STATE } from '@open-northland/sim';
import { Container, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import { aabbIntersects, screenToCell, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { PAGE_SAMPLER_SLOTS } from '../terrain/page-samplers.js';
import { type DecorCoverBinding, makeShadedDecorShader } from '../terrain/shading.js';
import { recolourOf } from '../textures/recoloured-pages.js';
import { SHADOW_BLUR_PADDING } from '../textures/soft-shadow-cache.js';
import { updateByteRange } from '../world-batch/attribute-buffer.js';
import { CLIP_FLOATS, CLIP_SCALE, type DecorClipBinding, NO_CLIP } from './decor-clip.js';
import { type DecorShadowUniforms, makeDecorShadowShader } from './decor-shadow-shader.js';
import { type MapObjectSprite, objectFrameAt, objectFrameIndexAt } from './map-object-sprite.js';

/**
 * Flat ground decor batched into per-block quad meshes, a block's pages sharing its draw calls.
 * Translucency rides in the atlas texture's own alpha channel; there is no per-object opacity. An
 * object's cast shadow batches the same way from its silhouette page, into a container the layer draws
 * under every decor body, in quads the soft edge's reach wider than their frames. An animated quad of a
 * paged mesh picks its frame on the GPU (`decor-clip.ts`); one of a plain mesh is rewritten here as the
 * play-head moves.
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
/** The LUT row of a quad of a coloured page. */
const NO_LUT_ROW = -1;
/** The brightness of a quad shaded only to be recoloured, which draws its texel as a plain mesh. */
const PLAIN_QUAD = -1;
const VERTICES_PER_QUAD = 4;
/** `aFrame` is a vec4 per vertex: the frame's min and max texel corner. */
const FRAME_BOUND_FLOATS = 4;
const FRAME_FLOATS_PER_QUAD = FRAME_BOUND_FLOATS * VERTICES_PER_QUAD;
/** `aAnchor` is a vec2 per vertex: the object's drawn feet, which the weather cover reads and an animated
 *  quad places its clip frames by. Every quad of a paged mesh carries it and `aClip`, 32 and 64 bytes a
 *  quad, with or without weather: magiczny_las has 88,710 such quads, 2.7 and 5.4 MB, held on the GPU
 *  and again in the CPU copy. */
const ANCHOR_FLOATS = 2;

/** What a quad write fills: a batch's buffers, and the page size its UVs divide by. `frameBounds`
 *  exists on the shadow lane only. */
export interface QuadBuffers {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly frameBounds: Float32Array | null;
  readonly pageW: number;
  readonly pageH: number;
}

/** Writes `frame` of `obj` as quad `quadIndex`: the placement the GPU clip reproduces, so the parity
 *  test holds the shader to this writer. */
export function writeObjectQuad(
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

/** The uniforms every decor batch of a layer shares: its cast-shadow style, its weather cover and its
 *  clip table and clock. */
export interface DecorBatchStyle {
  readonly shadow: DecorShadowUniforms;
  readonly cover: DecorCoverBinding;
  readonly clips: DecorClipBinding;
  readonly recolour: DecorRecolour;
}

/** How a recoloured stem's decor reads its colours: the LUT, and each frame's row of it
 *  ({@link NO_LUT_ROW} for a frame of a coloured page). */
export interface DecorRecolour {
  lut(): TextureSource;
  rowOf(source: TextureSource, frame: AtlasFrame): number;
}

/** The LUT row an object's body draws through, -1 for none; every frame of an object is one stem's. */
function bodyRow(obj: MapObjectSprite, recolour: DecorRecolour): number {
  const frame = obj.frames[0];
  return frame === undefined ? -1 : recolour.rowOf(obj.source, frame);
}

/** The objects of one page on one lane that draw together, still or animated. */
interface BatchSpec {
  readonly source: TextureSource;
  readonly objects: MapObjectSprite[];
  readonly moving: boolean;
}

/** Whether any of a body batch's objects carries a brightness of its own. */
const lit = (objects: readonly MapObjectSprite[]): boolean =>
  objects.some((obj) => obj.brightness !== undefined);

/** Whether a lane batch draws through a paged shader, which lets it share a mesh with other pages: every
 *  cast shadow does, and a body with any per-object brightness takes the shaded ground shader, as does
 *  a recoloured body, which only that shader colours. */
function paged(lane: DecorLane, objects: readonly MapObjectSprite[], recolour: DecorRecolour): boolean {
  if (lane === 'shadow' || lit(objects)) return true;
  const first = objects[0];
  return first !== undefined && bodyRow(first, recolour) >= 0;
}

/** One mesh's buffers, filled run batch by run batch. A paged mesh carries every quad's feet and clip,
 *  a still quad's clip being {@link NO_CLIP}. */
interface RunBuffers {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly frameBounds: Float32Array | null;
  readonly indices: Uint32Array;
  readonly brightness: Float32Array | null;
  /** Each body quad's LUT row, -1 for a coloured page. */
  readonly lutRows: Float32Array | null;
  readonly anchors: Float32Array | null;
  readonly pages: Float32Array | null;
  readonly clips: Float32Array | null;
}

/**
 * Batch `run`, consecutive lane batches in paint order, into one mesh of quads written for their tick-0
 * frame. Each batch keeps views into the shared buffers, so an animated one rewrites its quads in place
 * as before, and the quads keep the batches' order, the paint order separate meshes had. A paged mesh
 * names each quad's page among `pages`; a shaded body's brightness multiplier is constant across a
 * quad's four vertices, so an animated rewrite never touches it.
 */
function buildRun(
  run: readonly BatchSpec[],
  pages: readonly TextureSource[],
  lane: DecorLane,
  style: DecorBatchStyle,
  container: Container,
  animation: ChunkAnimation,
  placed: (obj: MapObjectSprite, quad: DecorQuadRef) => void,
): void {
  const quads = run.reduce((n, spec) => n + spec.objects.length, 0);
  const isPaged = run.every((spec) => paged(lane, spec.objects, style.recolour));
  const shaded = lane === 'body' && isPaged;
  const buffers: RunBuffers = {
    positions: new Float32Array(quads * FLOATS_PER_QUAD),
    uvs: new Float32Array(quads * FLOATS_PER_QUAD),
    frameBounds: lane === 'shadow' ? new Float32Array(quads * FRAME_FLOATS_PER_QUAD) : null,
    indices: new Uint32Array(quads * 6),
    brightness: shaded ? new Float32Array(quads * VERTICES_PER_QUAD) : null,
    lutRows: shaded ? new Float32Array(quads * VERTICES_PER_QUAD).fill(NO_LUT_ROW) : null,
    anchors: isPaged ? new Float32Array(quads * VERTICES_PER_QUAD * ANCHOR_FLOATS) : null,
    pages: isPaged ? new Float32Array(quads * VERTICES_PER_QUAD) : null,
    clips: isPaged ? new Float32Array(quads * VERTICES_PER_QUAD * CLIP_FLOATS) : null,
  };
  const geometry = new MeshGeometry({
    positions: buffers.positions,
    uvs: buffers.uvs,
    indices: buffers.indices,
  });
  let base = 0;
  for (const spec of run) {
    const views: QuadBuffers = {
      positions: buffers.positions.subarray(
        base * FLOATS_PER_QUAD,
        (base + spec.objects.length) * FLOATS_PER_QUAD,
      ),
      uvs: buffers.uvs.subarray(base * FLOATS_PER_QUAD, (base + spec.objects.length) * FLOATS_PER_QUAD),
      frameBounds:
        buffers.frameBounds?.subarray(
          base * FRAME_FLOATS_PER_QUAD,
          (base + spec.objects.length) * FRAME_FLOATS_PER_QUAD,
        ) ?? null,
      pageW: spec.source.width,
      pageH: spec.source.height,
    };
    writeBatch(spec, views, buffers, base, pages.indexOf(spec.source), lane, style.recolour);
    let animBatch: AnimatedDecorBatch | null = null;
    let clipBatch: ClipDecorBatch | null = null;
    if (spec.moving && buffers.clips !== null) {
      clipBatch = writeClips(spec, buffers.clips, base, lane, style.clips, geometry);
      animation.clipped.push(clipBatch);
    } else if (spec.moving) {
      animBatch = {
        lane,
        objects: spec.objects,
        buffers: views,
        geometry,
        written: spec.objects.map((obj) => laneFrameAt(obj, lane, 0)),
        uploadPending: false,
        firstQuad: base,
      };
      animation.animated.push(animBatch);
    }
    for (const [q, obj] of spec.objects.entries()) {
      placed(obj, {
        positions: views.positions,
        clips: buffers.clips,
        geometry,
        quadIndex: q,
        firstQuad: base,
        animated: animBatch,
        clipped: clipBatch,
      });
    }
    base += spec.objects.length;
  }
  if (buffers.brightness !== null) geometry.addAttribute('aBrightness', { buffer: buffers.brightness });
  if (buffers.lutRows !== null) geometry.addAttribute('aLutRow', { buffer: buffers.lutRows });
  if (buffers.anchors !== null)
    geometry.addAttribute('aAnchor', { buffer: buffers.anchors, format: 'float32x2' });
  if (buffers.frameBounds !== null) geometry.addAttribute('aFrame', { buffer: buffers.frameBounds });
  if (buffers.pages !== null) geometry.addAttribute('aPage', { buffer: buffers.pages });
  if (buffers.clips !== null) geometry.addAttribute('aClip', { buffer: buffers.clips, format: 'float32x4' });
  // A mesh with a shader of its own never reads a texture, so only the plain batch mints one.
  let mesh: Mesh<MeshGeometry, Shader>;
  if (lane === 'shadow')
    mesh = new Mesh({ geometry, shader: makeDecorShadowShader(pages, style.shadow, style.clips) });
  else if (shaded)
    mesh = new Mesh({
      geometry,
      shader: makeShadedDecorShader(pages, style.cover, style.clips, style.recolour.lut()),
    });
  else mesh = new Mesh({ geometry, texture: new Texture({ source: pages[0] ?? Texture.EMPTY.source }) });
  container.addChild(mesh);
}

/**
 * List `spec`'s clips in the table and write each quad's `aClip` at `base` of the run: a quad of a
 * paged mesh plays on the GPU, starting watched.
 */
function writeClips(
  spec: BatchSpec,
  clips: Float32Array,
  base: number,
  lane: DecorLane,
  binding: DecorClipBinding,
  geometry: MeshGeometry,
): ClipDecorBatch {
  const margin = laneMargin(lane);
  const objects = spec.objects;
  for (let q = 0; q < objects.length; q++) {
    const obj = objects[q];
    if (obj === undefined) continue;
    const frames = lane === 'body' ? obj.frames : (obj.shadow?.frames ?? []);
    const count = obj.frames.length;
    const entry = binding.table.entryOf({ frames, page: spec.source, margin }, count);
    writeClip(clips, base + q, [
      entry,
      obj.once === undefined ? count : -count,
      obj.once === undefined ? obj.phase : obj.once.from,
      obj.scale,
    ]);
  }
  return {
    objects: [...objects],
    clips,
    geometry,
    firstQuad: base,
    watched: new Uint8Array(objects.length).fill(WATCHED),
    uploadFrom: Number.POSITIVE_INFINITY,
    uploadTo: Number.NEGATIVE_INFINITY,
  };
}

/** Write a quad's clip over its four vertices. */
function writeClip(clips: Float32Array, quad: number, clip: readonly number[]): void {
  for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex++)
    clips.set(clip, (quad * VERTICES_PER_QUAD + vertex) * CLIP_FLOATS);
}

/** Write one lane batch's quads at `base` of the run: its own views for the quads, the run's buffers for
 *  the per-quad constants. */
function writeBatch(
  spec: BatchSpec,
  views: QuadBuffers,
  buffers: RunBuffers,
  base: number,
  page: number,
  lane: DecorLane,
  recolour: DecorRecolour,
): void {
  const { objects } = spec;
  // A batch shaded only to be recoloured draws its texels as the plain mesh it was: brightness -1.
  const plain = !lit(objects);
  for (let q = 0; q < objects.length; q++) {
    const quad = base + q;
    // Indexed whatever the pose holds: a quad without a frame stays degenerate until a rewrite fills it.
    buffers.indices.set(
      [quad * 4, quad * 4 + 1, quad * 4 + 2, quad * 4, quad * 4 + 2, quad * 4 + 3],
      quad * 6,
    );
    buffers.pages?.fill(page, quad * VERTICES_PER_QUAD, (quad + 1) * VERTICES_PER_QUAD);
    const obj = objects[q];
    if (obj === undefined) continue;
    // Whatever the pose of tick 0: an animated quad places every frame of its clip by its feet.
    if (buffers.anchors !== null) {
      for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex++) {
        const a = (quad * VERTICES_PER_QUAD + vertex) * ANCHOR_FLOATS;
        buffers.anchors[a] = obj.x;
        buffers.anchors[a + 1] = obj.y - (obj.lift ?? 0);
      }
    }
    // Before the pose check: a quad without a tick-0 frame keeps its row for the frames a rewrite gives it.
    buffers.lutRows?.fill(bodyRow(obj, recolour), quad * VERTICES_PER_QUAD, (quad + 1) * VERTICES_PER_QUAD);
    const frame = laneFrameAt(obj, lane, 0);
    if (frame === undefined) continue;
    writeObjectQuad(views, q, obj, frame, laneMargin(lane));
    buffers.brightness?.fill(
      plain ? PLAIN_QUAD : (obj.brightness ?? 1),
      quad * VERTICES_PER_QUAD,
      (quad + 1) * VERTICES_PER_QUAD,
    );
  }
}

/** One animated decor batch: its mesh buffers + the objects whose quads fill them, in quad order.
 *  A removed object's slot is `null` - its quad stays zeroed and the rewrite loop skips it. */
export interface AnimatedDecorBatch {
  readonly lane: DecorLane;
  readonly objects: (MapObjectSprite | null)[];
  readonly buffers: QuadBuffers;
  readonly geometry: MeshGeometry;
  /** The pose each quad last drew, `undefined` for a collapsed one; the build writes the tick-0 pose. */
  readonly written: (AtlasFrame | undefined)[];
  /** Whether a rewrite since the last upload left the buffers ahead of the GPU copy. */
  uploadPending: boolean;
  /** Where the batch's quads start in its mesh, which it may share with other batches. */
  readonly firstQuad: number;
}

/** A {@link ClipDecorBatch} quad's flag: its cell is watched, so its clip plays. */
const WATCHED = 1;
const UNWATCHED = 0;

/**
 * The animated quads of one batch of a paged mesh, which pick their frames on the GPU: all a frame
 * rewrites of them is, on a fog change, the sign of each one's clip scale, which says whether its cell is
 * watched. A removed object's slot is `null` - its quad stays collapsed and the fog loop skips it.
 */
export interface ClipDecorBatch {
  readonly objects: (MapObjectSprite | null)[];
  /** The mesh's `aClip` data, every quad's. */
  readonly clips: Float32Array;
  readonly geometry: MeshGeometry;
  /** Where the batch's quads start in its mesh. */
  readonly firstQuad: number;
  /** Per object, {@link WATCHED} or {@link UNWATCHED}. */
  readonly watched: Uint8Array;
  /** The mesh quads the next upload covers, an empty range when nothing changed. */
  uploadFrom: number;
  uploadTo: number;
}

/** A chunk's animated batches as its lanes build them. */
interface ChunkAnimation {
  readonly animated: AnimatedDecorBatch[];
  readonly clipped: ClipDecorBatch[];
}

/** Animated decor bins partition a chunk into squares of this many tiles a side. */
const ANIMATED_BIN_TILES = 4;
const ANIMATED_BIN_PX = ANIMATED_BIN_TILES * TILE_HALF_W * 2;

/** The quads of one animated batch that fall in a bin, and the cell each one's fog is read at, as
 *  column and row pairs. */
interface AnimatedRun {
  readonly batch: AnimatedDecorBatch;
  readonly quads: readonly number[];
  readonly cells: Int32Array;
}

/** The quads of one GPU-played batch that fall in a bin, and the cell each one's fog is read at, as
 *  column and row pairs. */
interface ClipRun {
  readonly batch: ClipDecorBatch;
  readonly quads: readonly number[];
  readonly cells: Int32Array;
}

/**
 * The animated quads of a chunk whose objects anchor in one square, culled as one box over every frame
 * they can show, so a frame rewrites the quads in view rather than the whole chunk.
 */
interface AnimatedBin extends Bounds {
  readonly runs: readonly AnimatedRun[];
  readonly clipRuns: readonly ClipRun[];
  /** The tick and the fog its CPU-written quads were last written for. Per bin, so a bin scrolling into
   *  view while the sim is paused still catches up to the current tick's frame. */
  lastWrittenTick: number;
  writtenFog: number;
  /** The fog its GPU-played quads were last flagged for. */
  clipEpoch: number;
}

/** A bin's fog key while the view draws without fog; fog epochs count up from 0. A probe without an
 *  epoch keys NaN, which matches nothing, so it writes every time. */
const NO_FOG = Number.NEGATIVE_INFINITY;

/** Rewrite quad `q` of an animated batch for `tick`; a pose without a frame collapses the quad. False
 *  when the quad already shows that pose, which leaves its buffers untouched. */
function writeAnimatedQuad(
  batch: AnimatedDecorBatch,
  q: number,
  obj: MapObjectSprite,
  tick: number,
): boolean {
  const frame = laneFrameAt(obj, batch.lane, tick);
  if (batch.written[q] === frame) return false;
  batch.written[q] = frame;
  if (frame === undefined) {
    batch.buffers.positions.fill(0, q * FLOATS_PER_QUAD, (q + 1) * FLOATS_PER_QUAD);
    return true;
  }
  writeObjectQuad(batch.buffers, q, obj, frame, laneMargin(batch.lane));
  return true;
}

/** Upload quads `[first, end)` of a mesh's per-quad attributes, not the still batches beside them. */
function uploadQuads(geometry: MeshGeometry, first: number, end: number, frameBounds: boolean): void {
  const quadBytes = FLOATS_PER_QUAD * Float32Array.BYTES_PER_ELEMENT;
  for (const name of ['aPosition', 'aUV']) {
    updateByteRange(geometry.getBuffer(name), first * quadBytes, (end - first) * quadBytes);
  }
  if (!frameBounds) return;
  const frameBytes = FRAME_FLOATS_PER_QUAD * Float32Array.BYTES_PER_ELEMENT;
  updateByteRange(geometry.getBuffer('aFrame'), first * frameBytes, (end - first) * frameBytes);
}

/** Upload an animated batch's rewritten quads. */
function uploadAnimatedBatch(batch: AnimatedDecorBatch): void {
  uploadQuads(
    batch.geometry,
    batch.firstQuad,
    batch.firstQuad + batch.objects.length,
    batch.buffers.frameBounds !== null,
  );
}

/** Where one quad of a decor object lives. */
interface DecorQuadRef {
  readonly positions: Float32Array;
  /** The mesh's `aClip` data, or null for a plain mesh. */
  readonly clips: Float32Array | null;
  readonly geometry: MeshGeometry;
  readonly quadIndex: number;
  /** Where {@link positions} starts in the mesh, in quads. */
  readonly firstQuad: number;
  /** The rewrite batch the quad belongs to, or null for a still (never-rewritten) batch. */
  readonly animated: AnimatedDecorBatch | null;
  /** The GPU-played batch the quad belongs to, or null. */
  readonly clipped: ClipDecorBatch | null;
}

const CLIP_QUAD_BYTES = VERTICES_PER_QUAD * CLIP_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const STILL_CLIP: readonly number[] = [NO_CLIP, NO_CLIP, NO_CLIP, NO_CLIP];

/** Collapse a quad for good: zeroed in place, and dropped from its batch's rewrite loop. */
export function retireDecorQuad(quad: DecorQuadRef): void {
  quad.positions.fill(0, quad.quadIndex * FLOATS_PER_QUAD, (quad.quadIndex + 1) * FLOATS_PER_QUAD);
  const quadBytes = FLOATS_PER_QUAD * Float32Array.BYTES_PER_ELEMENT;
  const meshQuad = quad.firstQuad + quad.quadIndex;
  updateByteRange(quad.geometry.getBuffer('aPosition'), meshQuad * quadBytes, quadBytes);
  if (quad.animated !== null) quad.animated.objects[quad.quadIndex] = null;
  if (quad.clipped !== null) quad.clipped.objects[quad.quadIndex] = null;
  // A quad drawn as written draws its zeroed corners: nothing.
  if (quad.clips !== null) {
    writeClip(quad.clips, meshQuad, STILL_CLIP);
    updateByteRange(quad.geometry.getBuffer('aClip'), meshQuad * CLIP_QUAD_BYTES, CLIP_QUAD_BYTES);
  }
}

/** A decor object's quads: its body, and its cast shadow when it carries one. */
interface DecorObjectQuads {
  readonly body: DecorQuadRef;
  shadow: DecorQuadRef | null;
}

/**
 * One decor chunk: flat map objects batched by texture source into meshes, AABB-culled like terrain
 * chunks. Static batches are built once; an animated batch's buffers are rewritten in place when the
 * play-head advances, and only for the bins in view.
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
  /** Animated batches the GPU plays, whose fog flags a fog change rewrites. */
  readonly clipped: ClipDecorBatch[];
  /** The {@link animated} and {@link clipped} quads by where they draw. */
  readonly animatedBins: readonly AnimatedBin[];
  readonly quads: Map<MapObjectSprite, DecorObjectQuads>;
}

/** Batch one lane of a block into `container`: a still and an animated batch per texture source, in
 *  that order, consecutive paged batches sharing a mesh of up to {@link PAGE_SAMPLER_SLOTS} pages (quads
 *  of one batch share a page; opacity is per pixel, in the page). Reports each object's quad to `placed`. */
function buildLane(
  block: readonly MapObjectSprite[],
  lane: DecorLane,
  container: Container,
  style: DecorBatchStyle,
  animation: ChunkAnimation,
  placed: (obj: MapObjectSprite, quad: DecorQuadRef) => void,
): void {
  // One group per page, and per stem on a recoloured page: each stem's quads draw together, in the
  // order the stems first appear in the block.
  const groups = new Map<
    object,
    { source: TextureSource; still: MapObjectSprite[]; moving: MapObjectSprite[] }
  >();
  for (const obj of block) {
    const source = laneSource(obj, lane);
    if (source === undefined) continue;
    const first = lane === 'body' ? obj.frames[0] : undefined;
    const key = (first === undefined ? undefined : recolourOf(first)) ?? source;
    let group = groups.get(key);
    if (group === undefined) {
      group = { source, still: [], moving: [] };
      groups.set(key, group);
    }
    (obj.frames.length > 1 ? group.moving : group.still).push(obj);
  }
  let run: BatchSpec[] = [];
  let pages: TextureSource[] = [];
  const flush = (): void => {
    if (run.length > 0) buildRun(run, pages, lane, style, container, animation, placed);
    run = [];
    pages = [];
  };
  for (const group of groups.values()) {
    const { source } = group;
    for (const objects of [group.still, group.moving]) {
      if (objects.length === 0) continue;
      const spec: BatchSpec = { source, objects, moving: objects === group.moving };
      if (!paged(lane, objects, style.recolour)) {
        flush();
        buildRun([spec], [source], lane, style, container, animation, placed);
        continue;
      }
      if (!pages.includes(source) && pages.length === PAGE_SAMPLER_SLOTS) flush();
      if (!pages.includes(source)) pages.push(source);
      run.push(spec);
    }
  }
  flush();
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/** Grow `bounds` over every frame `obj` can show (frames differ a little in size/offset), its
 *  silhouettes included. */
function includeObject(bounds: Bounds, obj: MapObjectSprite): void {
  const lanes: readonly [DecorLane, readonly (AtlasFrame | undefined)[]][] = [
    ['body', obj.frames],
    ['shadow', obj.shadow?.frames ?? []],
  ];
  for (const [lane, frames] of lanes) {
    const margin = laneMargin(lane);
    for (const frame of frames) {
      if (frame === undefined) continue;
      bounds.minX = Math.min(bounds.minX, obj.x + (frame.offsetX - margin) * obj.scale);
      bounds.minY = Math.min(bounds.minY, obj.y + (frame.offsetY - margin) * obj.scale);
      bounds.maxX = Math.max(bounds.maxX, obj.x + (frame.offsetX + frame.width + margin) * obj.scale);
      bounds.maxY = Math.max(bounds.maxY, obj.y + (frame.offsetY + frame.height + margin) * obj.scale);
    }
  }
}

/** Sort a chunk's animated quads into bins by their object's anchor. */
function binAnimated(animation: ChunkAnimation): AnimatedBin[] {
  interface Gathering {
    readonly bounds: Bounds;
    readonly runs: Map<AnimatedDecorBatch, number[]>;
    readonly clipRuns: Map<ClipDecorBatch, number[]>;
  }
  const bins = new Map<string, Gathering>();
  const binOf = (obj: MapObjectSprite): Gathering => {
    const key = `${Math.floor(obj.x / ANIMATED_BIN_PX)},${Math.floor(obj.y / ANIMATED_BIN_PX)}`;
    let bin = bins.get(key);
    if (bin === undefined) {
      bin = { bounds: emptyBounds(), runs: new Map(), clipRuns: new Map() };
      bins.set(key, bin);
    }
    includeObject(bin.bounds, obj);
    return bin;
  };
  const gather = <B>(runs: Map<B, number[]>, batch: B, q: number): void => {
    let quads = runs.get(batch);
    if (quads === undefined) {
      quads = [];
      runs.set(batch, quads);
    }
    quads.push(q);
  };
  for (const batch of animation.animated)
    for (const [q, obj] of batch.objects.entries()) if (obj !== null) gather(binOf(obj).runs, batch, q);
  for (const batch of animation.clipped)
    for (const [q, obj] of batch.objects.entries()) if (obj !== null) gather(binOf(obj).clipRuns, batch, q);
  return [...bins.values()].map(({ bounds, runs, clipRuns }) => ({
    ...bounds,
    runs: [...runs].map(([batch, quads]) => ({ batch, quads, cells: cellsOf(batch, quads) })),
    clipRuns: [...clipRuns].map(([batch, quads]) => ({ batch, quads, cells: cellsOf(batch, quads) })),
    lastWrittenTick: 0,
    writtenFog: Number.NaN,
    clipEpoch: Number.NaN,
  }));
}

/** The fog cells of `quads`' objects, as column and row pairs. */
function cellsOf(
  batch: { readonly objects: readonly (MapObjectSprite | null)[] },
  quads: readonly number[],
): Int32Array {
  const cells = new Int32Array(quads.length * 2);
  for (const [i, q] of quads.entries()) {
    const obj = batch.objects[q];
    if (obj === null || obj === undefined) continue;
    const cell = screenToCell(obj.x, obj.y);
    cells[i * 2] = cell.col;
    cells[i * 2 + 1] = cell.row;
  }
  return cells;
}

/** Batch one decor block. The caller owns attaching the returned chunk's containers to its layers. */
export function buildDecorChunk(block: readonly MapObjectSprite[], style: DecorBatchStyle): DecorChunk {
  const bounds = emptyBounds();
  for (const obj of block) includeObject(bounds, obj);
  const container = new Container();
  const shadowContainer = new Container();
  const animation: ChunkAnimation = { animated: [], clipped: [] };
  const quads = new Map<MapObjectSprite, DecorObjectQuads>();
  buildLane(block, 'body', container, style, animation, (obj, body) => {
    quads.set(obj, { body, shadow: null });
  });
  buildLane(block, 'shadow', shadowContainer, style, animation, (obj, shadow) => {
    const placed = quads.get(obj);
    if (placed !== undefined) placed.shadow = shadow;
  });
  // Animated quads were written for tick 0 at build; the first update rewrites any other tick.
  const animatedBins = binAnimated(animation);
  return {
    container,
    shadowContainer,
    ...bounds,
    animated: animation.animated,
    clipped: animation.clipped,
    animatedBins,
    quads,
  };
}

/**
 * Bring a visible chunk's animated quads in `vp` to `tick`, each bin once per tick and fog answer. A
 * quad on ground the viewer does not watch shows its fixed-clock frame: a quad the CPU rewrites is
 * written so, and one the GPU plays is flagged so, whenever the fog's answers change (`fogEpoch`;
 * undefined asks every time).
 * Quads outside `vp` keep their pose and flags until a frame shows them, so the work follows the
 * screen, not the chunk.
 */
export function animateDecorChunk(
  chunk: DecorChunk,
  vp: Viewport,
  tick: number,
  fogStateOfCell: ((cellX: number, cellY: number) => number) | undefined,
  fogEpoch?: number,
): void {
  const fog = fogStateOfCell === undefined ? NO_FOG : (fogEpoch ?? Number.NaN);
  for (const bin of chunk.animatedBins) {
    if (!aabbIntersects(vp, bin)) continue;
    // A fog change refreezes or thaws the CPU-written quads at once, as it does the GPU-played ones.
    if (bin.lastWrittenTick !== tick || bin.writtenFog !== fog) {
      bin.lastWrittenTick = tick;
      bin.writtenFog = fog;
      for (const { batch, quads, cells } of bin.runs) {
        for (let i = 0; i < quads.length; i++) {
          const q = quads[i] ?? 0;
          const obj = batch.objects[q];
          if (obj === null || obj === undefined) continue; // removed - its quad stays zeroed
          const watched =
            fogStateOfCell === undefined ||
            fogStateOfCell(cells[i * 2] ?? 0, cells[i * 2 + 1] ?? 0) === FOG_STATE.VISIBLE;
          if (writeAnimatedQuad(batch, q, obj, watched ? tick : 0)) batch.uploadPending = true;
        }
      }
    }
    if (fogStateOfCell === undefined || bin.clipEpoch === fog) continue;
    bin.clipEpoch = fog;
    for (const run of bin.clipRuns) flagWatched(run, fogStateOfCell);
  }
  for (const batch of chunk.animated) {
    if (!batch.uploadPending) continue;
    uploadAnimatedBatch(batch);
    batch.uploadPending = false;
  }
  for (const batch of chunk.clipped) {
    if (batch.uploadFrom > batch.uploadTo) continue;
    updateByteRange(
      batch.geometry.getBuffer('aClip'),
      batch.uploadFrom * CLIP_QUAD_BYTES,
      (batch.uploadTo - batch.uploadFrom + 1) * CLIP_QUAD_BYTES,
    );
    batch.uploadFrom = Number.POSITIVE_INFINITY;
    batch.uploadTo = Number.NEGATIVE_INFINITY;
  }
}

/** Flag each quad of `run` watched or not by its cell's fog, flipping its clip scale's sign on a change. */
function flagWatched(run: ClipRun, fogStateOfCell: (cellX: number, cellY: number) => number): void {
  const { batch, quads, cells } = run;
  for (const [i, q] of quads.entries()) {
    if (batch.objects[q] === null) continue;
    const watched =
      fogStateOfCell(cells[i * 2] ?? 0, cells[i * 2 + 1] ?? 0) === FOG_STATE.VISIBLE ? WATCHED : UNWATCHED;
    if (batch.watched[q] === watched) continue;
    batch.watched[q] = watched;
    const quad = batch.firstQuad + q;
    for (let vertex = 0; vertex < VERTICES_PER_QUAD; vertex++) {
      const at = (quad * VERTICES_PER_QUAD + vertex) * CLIP_FLOATS + CLIP_SCALE;
      batch.clips[at] = -(batch.clips[at] ?? 0);
    }
    batch.uploadFrom = Math.min(batch.uploadFrom, quad);
    batch.uploadTo = Math.max(batch.uploadTo, quad);
  }
}
