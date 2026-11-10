import {
  type Batch,
  type BatchableElement,
  Batcher,
  type BatcherOptions,
  Buffer,
  BufferUsage,
  Container,
  type DefaultBatchableMeshElement,
  type DefaultBatchableQuadElement,
  ExtensionType,
  extensions,
  Geometry,
  type GlobalUniformGroup,
  getBatchSamplersUniformGroup,
  type InstructionSet,
  type Renderer,
  type RenderGroup,
  Shader,
  type Texture,
  type TextureSource,
  UniformGroup,
  type ViewContainer,
  WebGLRenderer,
} from 'pixi.js';
import { BloodSurfaceSprite } from '../blood/surface-sprite.js';
import { MAGNIFIED_BELOW } from '../pixel-art/magnify.js';
import {
  hasPrescaledPages,
  isCollectingDrawnPages,
  isIndexedSource,
  isMagnifiedTexture,
  isShadowTexture,
  noteDrawnPage,
  palettedLutOf,
  palettedRowOf,
  pixelArtMagnifyMode,
  prescaledPageOf,
  WORLD_MAGNIFY_MODES,
  worldShadowStyle,
} from '../pixel-art/registry.js';
import { OutlineSprite, SelectionGraphics, SelectionSprite } from '../selection/sprite-effect.js';
import { glProgramFor } from '../shaders/program-source.js';
import { WorldAttributeBuffer } from './attribute-buffer.js';
import {
  LUT_SLOTS,
  lutSlotOf,
  WORLD_BATCH_MAX_TEXTURES,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_INDEXED,
  WORLD_FLAG_MAGNIFY,
  WORLD_FLAG_MIPMAPPED,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_RECOLOURED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
  type WorldBatchSampling,
  worldBatchProgramSource,
} from './shader.js';
import type { ShadowStyle } from './shadow-style.js';

export {
  lutSlotOf,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_INDEXED,
  WORLD_FLAG_MIPMAPPED,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_RECOLOURED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
} from './shader.js';

/** Pixi hard-codes its default batcher per instruction set; a world sprite opts into this one by name. */
const WORLD_BATCHER = 'world';

/** Sprites drawn through the world batcher. */
const worldSprites = new WeakSet<object>();
const routedPipes = new WeakSet<object>();

/** Route a sprite's batches through the world batcher, on every renderer {@link routeWorldBatches} set up. */
export function worldBatched<T extends ViewContainer>(sprite: T): T {
  worldSprites.add(sprite);
  return sprite;
}

/** Whether {@link worldBatched} routed `sprite` through the world batcher. */
export function isWorldBatched(sprite: object): boolean {
  return worldSprites.has(sprite);
}

/**
 * Pixi mints each sprite's batchable record lazily per renderer, always named `default`, and replaces it
 * on `unload()`; the renderer's batch pipe renames a world sprite's record when it next batches. Only a
 * record still named `default` pays the membership lookup. Idempotent per renderer.
 */
export function routeWorldBatches(renderer: Renderer): void {
  const pipe = renderer.renderPipes.batch;
  if (routedPipes.has(pipe)) return;
  routedPipes.add(pipe);
  const addToBatch = pipe.addToBatch.bind(pipe);
  pipe.addToBatch = (element, instructionSet) => {
    if (element.batcherName !== WORLD_BATCHER) {
      const renderable = renderableOf(element);
      if (renderable !== null && worldSprites.has(renderable)) element.batcherName = WORLD_BATCHER;
    }
    addToBatch(element, instructionSet);
  };
}

const lutBoundPipes = new WeakSet<object>();

/** The pages a batch listed where their prescaled twins stood in for one draw, by slot. */
const listedPages: (TextureSource | undefined)[] = [];
/** Every world batch program's shader: a draw through one samples pages a twin may stand in for, whoever
 *  built the draw (the world batcher, or the still mesh's retained draws). */
const worldBatchShaders = new WeakSet<Shader>();

/** The prescaled program's per-draw uniform: one bit per slot that holds a twin, so the shader can
 *  read a frame in its page's own texels. */
type TwinSlotsUniforms = UniformGroup<{ uTwinSlots: { value: number; type: 'i32' } }>;
const twinSlotsOf = new WeakMap<Shader, TwinSlotsUniforms>();
/** Every world batch program's per-draw list of page sizes, two floats per slot. */
type PageSizeUniforms = UniformGroup<{
  uPageSizes: { value: Float32Array; type: 'vec2<f32>'; size: number };
}>;
const pageSizesOf = new WeakMap<Shader, PageSizeUniforms>();

/**
 * A paletted world batch lists its LUT in every slot between its pages and the LUT's own, so the list has
 * no holes; no element samples those slots, so its draw binds only the pages and the LUT, and the slots a
 * neighbouring batch's pages hold stay bound. Any batcher that names its batches' LUT binding draws this
 * way, the still mesh's bands among them. A draw through a world batch program binds each listed page's
 * prescaled twin in the page's place, whichever batcher built it, and hands the program the listed
 * textures' sizes, which a world batch program reads its pages' sizes from: without this binding its
 * draws see zero-sized pages. Idempotent per renderer.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: the WebGL batch adaptor
 * binds every slot below `batch.textures.count` before it draws and reads the list nowhere else.
 */
export function bindWorldBatchPagesAndLut(renderer: Renderer): void {
  // WebGPU builds a bind group from the whole list instead of binding slot by slot.
  if (!(renderer instanceof WebGLRenderer)) return;
  const pipe = renderer.renderPipes.batch;
  if (lutBoundPipes.has(pipe)) return;
  lutBoundPipes.add(pipe);
  const execute = pipe.execute.bind(pipe);
  pipe.execute = (batch: Batch) => {
    if (batch.action === 'startBatch') noteDrawScale(renderer);
    const batcher: unknown = batch.batcher;
    const binding = listsLut(batcher) ? batcher.lutBinding(batch) : null;
    const shader = batch.batcher.shader;
    const twins = shader !== undefined && worldBatchShaders.has(shader);
    if (binding === null && !twins) {
      execute(batch);
      return;
    }
    const textures = batch.textures;
    const listed = textures.count;
    const swaps =
      twins && (hasPrescaledPages() || isCollectingDrawnPages())
        ? swapInPrescaledPages(textures.textures, listed)
        : 0;
    if (twins) {
      // The program must be current for the uploads; a batch that starts a run binds it again, unsynced.
      renderer.shader.bind(shader, true);
      const pageSizes = pageSizesOf.get(shader);
      if (pageSizes !== undefined) {
        // The program reads a size per page slot only: the LUT and the slots it fills have none to tell.
        const pages = binding === null ? listed : binding.pages;
        if (writePageSizes(pageSizes.uniforms.uPageSizes, textures.textures, pages)) pageSizes.update();
        renderer.shader.updateUniformGroup(pageSizes);
      }
      const twinSlots = twinSlotsOf.get(shader);
      if (twinSlots !== undefined) {
        if (twinSlots.uniforms.uTwinSlots !== swaps) {
          twinSlots.uniforms.uTwinSlots = swaps;
          twinSlots.update();
        }
        renderer.shader.updateUniformGroup(twinSlots);
      }
    }
    if (binding !== null) {
      renderer.texture.bind(binding.lut, binding.slot);
      textures.count = binding.pages;
    }
    try {
      execute(batch);
    } finally {
      textures.count = listed;
      if (swaps !== 0) restoreListedPages(textures.textures, listed);
    }
  };
}

/**
 * Screen pixels per render-group unit of the draw starting now, along its larger axis, or infinity when
 * the group is rotated or sheared, which the unmagnified program's bound does not cover. Read where a
 * batch run starts, after Pixi pushed the group's transform, and before its shader is chosen.
 */
let drawPixelsPerUnit = Number.POSITIVE_INFINITY;
/** How far a draw's texel bound must clear {@link MAGNIFIED_BELOW} for the unmagnified program: the
 *  shader's derivative noise of a few thousandths of a texel must not take a fragment below it. */
const UNMAGNIFIED_MARGIN = 1.01;
/** Whether an element's body may gather: on a page marked for magnification, or paletted, except a
 *  recoloured stem's frame, which takes the plain page's path. */
function gathers(flags: number): boolean {
  if ((flags & WORLD_FLAG_MAGNIFY) !== 0) return true;
  return (flags & WORLD_FLAG_PALETTED) !== 0 && (flags & WORLD_FLAG_RECOLOURED) === 0;
}
/** Off-axis terms below this share of the group's scale count as none. */
const AXIS_ALIGNED_TOLERANCE = 1e-6;

function noteDrawScale(renderer: Renderer): void {
  const globals: GlobalUniformGroup = renderer.globalUniforms.uniformGroup;
  const uniforms = globals.uniforms;
  const projection = uniforms.uProjectionMatrix;
  const world = uniforms.uWorldTransformMatrix;
  // Clip space spans two units across the target's pixels.
  const halfWidth = (uniforms.uResolution[0] ?? 0) / 2;
  const halfHeight = (uniforms.uResolution[1] ?? 0) / 2;
  const a = (projection.a * world.a + projection.c * world.b) * halfWidth;
  const b = (projection.b * world.a + projection.d * world.b) * halfHeight;
  const c = (projection.a * world.c + projection.c * world.d) * halfWidth;
  const d = (projection.b * world.c + projection.d * world.d) * halfHeight;
  const scale = Math.max(Math.abs(a), Math.abs(d));
  // An empty target has no scale to bound.
  const aligned = scale > 0 && Math.abs(b) + Math.abs(c) <= scale * AXIS_ALIGNED_TOLERANCE;
  drawPixelsPerUnit = aligned ? scale : Number.POSITIVE_INFINITY;
}

/** Writes each listed slot's texture size, in texels, as the program's `uPageSizes`; whether any
 *  changed. */
function writePageSizes(sizes: Float32Array, slots: readonly TextureSource[], count: number): boolean {
  let changed = false;
  for (let slot = 0; slot < count; slot++) {
    const page = slots[slot];
    if (page === undefined) continue;
    const at = 2 * slot;
    if (sizes[at] !== page.pixelWidth || sizes[at + 1] !== page.pixelHeight) {
      sizes[at] = page.pixelWidth;
      sizes[at + 1] = page.pixelHeight;
      changed = true;
    }
  }
  return changed;
}

/** Notes each listed page as drawn and puts its prescaled twin in its slot, keeping the page in
 *  {@link listedPages}; a bit per slot swapped. */
function swapInPrescaledPages(slots: TextureSource[], count: number): number {
  let swaps = 0;
  for (let slot = 0; slot < count; slot++) {
    const page = slots[slot];
    if (page === undefined) {
      listedPages[slot] = undefined;
      continue;
    }
    noteDrawnPage(page);
    const twin = prescaledPageOf(page);
    listedPages[slot] = twin === undefined ? undefined : page;
    if (twin === undefined) continue;
    slots[slot] = twin;
    swaps |= 1 << slot;
  }
  return swaps;
}

function restoreListedPages(slots: TextureSource[], count: number): void {
  for (let slot = 0; slot < count; slot++) {
    const page = listedPages[slot];
    if (page !== undefined) slots[slot] = page;
    listedPages[slot] = undefined;
  }
}

/** Vertex layout: Pixi's six (x, y, u, v, colour, textureIdAndRound) + element flags + frame UV box +
 *  selection, blood, splashes and night values. */
export const WORLD_VERTEX_SIZE = 18;
const STRIDE = WORLD_VERTEX_SIZE * 4;
/** A vertex's colour, in 32-bit words past its start. */
const COLOUR_AT = 4;
export const WORLD_ATTRIBUTE_OFFSETS = {
  aPosition: 0,
  aUV: 2 * 4,
  aColor: 4 * 4,
  aTextureIdAndRound: 5 * 4,
  aFlags: 6 * 4,
  aFrame: 7 * 4,
  aSelection: 11 * 4,
  aBlood: 12 * 4,
  aSplashes: 13 * 4,
  aNight: 17 * 4,
} as const;

/** A world sprite drawn through a palette LUT names its row here; its texture names the LUT. */
export interface PalettedRow {
  readonly lutRow: number;
  /** Draws the frame's coverage flat in the row's glow colour instead of its palette colours. */
  readonly glow: boolean;
}

/** The element's sprite: a batchable record names it `renderable`, which the element types omit. */
function renderableOf(element: BatchableElement): object | null {
  const renderable: unknown = (element as { renderable?: unknown }).renderable;
  return typeof renderable === 'object' ? renderable : null;
}

/** The sprite's own row, else the row its texture names (a recoloured stem's frame). */
function lutRowOf(element: BatchableElement, ownRow: number | undefined): number {
  const row: unknown = (renderableOf(element) as Partial<PalettedRow> | null)?.lutRow;
  return typeof row === 'number' ? row : (ownRow ?? 0);
}

function glowOf(element: BatchableElement): boolean {
  return (renderableOf(element) as Partial<PalettedRow> | null)?.glow === true;
}

/** A paletted world batch's LUT, the slot it is listed at, and the page slots listed below it. */
export interface LutBinding {
  lut: TextureSource;
  slot: number;
  pages: number;
}
/** A batcher whose batches may draw through a palette LUT bound past their pages. */
export interface LutListingBatcher {
  /** Where `batch` lists its LUT, or null for a batch without one; valid until the next call. */
  lutBinding(batch: Batch): LutBinding | null;
}
export interface WorldBatcherApi extends Batcher, LutListingBatcher {
  /** Packs `element` at `index` after a change Pixi reported, writing no more than changed. */
  repackQuad(
    element: DefaultBatchableQuadElement,
    float32View: Float32Array,
    uint32View: Uint32Array,
    index: number,
    textureId: number,
  ): void;
}
/** The batcher class, its geometry and shaders are defined on first install, not at import, so a
 *  test that mocks `pixi.js` can still load this module. */
type WorldBatcherClass = new (options: BatcherOptions) => WorldBatcherApi;
let worldBatcherClass: WorldBatcherClass | undefined;

function listsLut(batcher: unknown): batcher is LutListingBatcher {
  return (
    typeof batcher === 'object' &&
    batcher !== null &&
    typeof (batcher as Partial<LutListingBatcher>).lutBinding === 'function'
  );
}

/**
 * What a quad's last whole pack read apart from its transform and colour. While these hold, a repack
 * rewrites its corners and colour only: a sprite's texture, frame, anchor, palette row and effects each
 * move its view tick. The transform's first four terms are the ones its texel bound was last noted for.
 */
interface PackedQuad {
  sprite: object | null;
  viewTick: number;
  a: number;
  b: number;
  c: number;
  d: number;
  shading: boolean;
  /** Whether its body may gather, so its texel bound counts. */
  bounded: boolean;
  /** Page texels per unit of the quad's own x and y, before its transform; zero where snapping, a
   *  rotated frame or an empty quad leaves them unknown. */
  texelsX: number;
  texelsY: number;
}
const PACKED: unique symbol = Symbol('world quad pack');
type PackedQuadHost = DefaultBatchableQuadElement & { [PACKED]?: PackedQuad };

/** The sprite's count of view changes, or NaN, which equals nothing, where a whole pack must follow
 *  every update: no sprite to count them, or a blood surface, whose stains change without one. */
function movableViewTick(sprite: object | null): number {
  if (sprite === null || (sprite as { bloodSurface?: unknown }).bloodSurface !== undefined) return Number.NaN;
  const tick: unknown = (sprite as { _didViewChangeTick?: unknown })._didViewChangeTick;
  return typeof tick === 'number' ? tick : Number.NaN;
}

/** The world vertex layout over `attributeBuffer`, drawn through `indexBuffer`: the geometry a world batch
 *  or anything else drawing through the world batch program binds. */
export function worldBatchGeometry(attributeBuffer: Buffer, indexBuffer: Buffer): Geometry {
  const o = WORLD_ATTRIBUTE_OFFSETS;
  return new Geometry({
    attributes: {
      aPosition: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: o.aPosition },
      aUV: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: o.aUV },
      aColor: { buffer: attributeBuffer, format: 'unorm8x4', stride: STRIDE, offset: o.aColor },
      aTextureIdAndRound: {
        buffer: attributeBuffer,
        format: 'uint16x2',
        stride: STRIDE,
        offset: o.aTextureIdAndRound,
      },
      aFlags: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: o.aFlags },
      aFrame: { buffer: attributeBuffer, format: 'float32x4', stride: STRIDE, offset: o.aFrame },
      aSelection: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: o.aSelection },
      aBlood: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: o.aBlood },
      aSplashes: { buffer: attributeBuffer, format: 'float32x4', stride: STRIDE, offset: o.aSplashes },
      aNight: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: o.aNight },
    },
    indexBuffer,
  });
}

function defineWorldBatcher(): WorldBatcherClass {
  /** The one {@link LutBinding} every batcher answers with, minted by the first answer. */
  let lutBinding: LutBinding | undefined;
  const worldBatchIndices = (): Buffer =>
    new Buffer({
      data: new Uint32Array(1),
      label: 'world-batch-indices',
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });

  // Pixi uploads a batch shader's own uniforms only on that Shader object's first bind, so the
  // magnification mode and the shadow shading are compile-time constants instead: one program per
  // combination, shared by every batcher on the page. The shadow style is one fixed value or absent,
  // and a magnifying mode also has its unmagnified program, so the map holds at most four programs per
  // magnification mode.
  const shaders = new Map<string, Shader>();
  let lastShader:
    | {
        readonly maxTextures: number;
        readonly mode: number;
        readonly alphaGain: number | undefined;
        readonly maxAlpha: number | undefined;
        readonly tint: number | undefined;
        readonly sampling: WorldBatchSampling;
        readonly shader: Shader;
      }
    | undefined;

  function shadowKey(shadow: ShadowStyle | null): string {
    return shadow === null ? 'off' : `${shadow.alphaGain}/${shadow.maxAlpha}/${shadow.tint.toString(16)}`;
  }

  function shaderFor(
    maxTextures: number,
    mode: number,
    shadow: ShadowStyle | null,
    sampling: WorldBatchSampling,
  ): Shader {
    // Most batches use the same variant; avoid formatting its cache key on every bind.
    if (
      lastShader !== undefined &&
      lastShader.maxTextures === maxTextures &&
      lastShader.mode === mode &&
      lastShader.alphaGain === shadow?.alphaGain &&
      lastShader.maxAlpha === shadow?.maxAlpha &&
      lastShader.tint === shadow?.tint &&
      lastShader.sampling === sampling
    )
      return lastShader.shader;
    const shading = shadowKey(shadow);
    const key = `${maxTextures}:${mode}:${shading}:${sampling}`;
    let shader = shaders.get(key);
    if (shader === undefined) {
      const twinSlots: TwinSlotsUniforms | null =
        mode === WORLD_MAGNIFY_MODES.prescaled
          ? new UniformGroup({ uTwinSlots: { value: 0, type: 'i32' } })
          : null;
      // Static: Pixi uploads it only after an update(), when a draw's list changed.
      const pageSizes: PageSizeUniforms = new UniformGroup(
        { uPageSizes: { value: new Float32Array(2 * maxTextures), type: 'vec2<f32>', size: maxTextures } },
        { isStatic: true },
      );
      shader = new Shader({
        glProgram: glProgramFor(worldBatchProgramSource(maxTextures, mode, shadow, sampling)),
        resources: {
          batchSamplers: getBatchSamplersUniformGroup(maxTextures),
          pageSizes,
          ...(twinSlots === null ? {} : { twinSlots }),
        },
      });
      worldBatchShaders.add(shader);
      pageSizesOf.set(shader, pageSizes);
      if (twinSlots !== null) twinSlotsOf.set(shader, twinSlots);
      shaders.set(key, shader);
    }
    lastShader = {
      maxTextures,
      mode,
      alphaGain: shadow?.alphaGain,
      maxAlpha: shadow?.maxAlpha,
      tint: shadow?.tint,
      sampling,
      shader,
    };
    return shader;
  }

  /** The element being packed: what each of its vertices repeats, including its frame's UV box. Filled
   *  by {@link beginRenderable} and {@link beginElement} so the packers allocate nothing per element. */
  const packing = {
    selection: 0,
    blood: 0,
    night: 0,
    splash0: 0,
    splash1: 0,
    splash2: 0,
    splash3: 0,
    textureIdAndRound: 0,
    argb: 0,
    flags: 0,
    minU: 0,
    minV: 0,
    maxU: 0,
    maxV: 0,
  };

  function packSplashes(splashes: Float32Array | undefined): void {
    packing.splash0 = splashes?.[0] ?? 0;
    packing.splash1 = splashes?.[1] ?? 0;
    packing.splash2 = splashes?.[2] ?? 0;
    packing.splash3 = splashes?.[3] ?? 0;
  }

  /** Reads what the element's sprite itself adds to its vertices: its selection, blood and night values
   *  and its stains. Answers the sprite when it is an outline quad, for {@link packOutline}. */
  function beginRenderable(renderable: object | null): OutlineSprite | null {
    if (!(renderable instanceof BloodSurfaceSprite)) {
      packing.selection = renderable instanceof SelectionGraphics ? renderable.selectionEffect : 0;
      packing.blood = 0;
      packing.night = 0;
      packSplashes(undefined);
      return null;
    }
    const selects = renderable instanceof SelectionSprite;
    packing.selection = selects ? renderable.selectionEffect : 0;
    packing.blood = selects ? renderable.bloodEffect : 0;
    packing.night = selects ? renderable.nightLit : 0;
    const surface = renderable.bloodSurface;
    const stained = surface?.enabled === true;
    // Body coats are positive packed data; a facade uses the same slot for its negative UV cutoff.
    if (stained && surface.facade) packing.blood = -surface.clipY;
    packSplashes(stained ? surface.packed : undefined);
    return selects && renderable instanceof OutlineSprite ? renderable : null;
  }

  function beginElement(texture: Texture, textureIdAndRound: number, argb: number, flags: number): void {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = texture.uvs;
    packing.textureIdAndRound = textureIdAndRound;
    packing.argb = argb;
    packing.flags = flags;
    packing.minU = Math.min(x0, x1, x2, x3);
    packing.minV = Math.min(y0, y1, y2, y3);
    packing.maxU = Math.max(x0, x1, x2, x3);
    packing.maxV = Math.max(y0, y1, y2, y3);
  }

  /** An outline quad grows past its body: its taps stay inside the body's frame, and its reach rides in
   *  the splash slot, which a silhouette never reads. */
  function packOutline(outline: OutlineSprite): void {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = outline.bodyTexture.uvs;
    packing.minU = Math.min(x0, x1, x2, x3);
    packing.minV = Math.min(y0, y1, y2, y3);
    packing.maxU = Math.max(x0, x1, x2, x3);
    packing.maxV = Math.max(y0, y1, y2, y3);
    packSplashes(outline.reachUv);
  }

  /**
   * The fewest page texels per render-group unit a quad's fragments see under the transform `packed`
   * holds, as the shader measures its footprint: the larger of the two rows of the unit-to-texel map,
   * each row's absolute sum. Zero where the quad's own texel density is unknown.
   */
  function texelsPerUnitOf(packed: PackedQuad): number {
    const { a, b, c, d } = packed;
    const determinant = Math.abs(a * d - b * c);
    if (determinant === 0) return 0;
    return (
      Math.max(packed.texelsX * (Math.abs(d) + Math.abs(c)), packed.texelsY * (Math.abs(b) + Math.abs(a))) /
      determinant
    );
  }

  /** Write one vertex after its transformed position; returns the next vertex's index. */
  function packVertex(f32: Float32Array, u32: Uint32Array, index: number, u: number, v: number): number {
    f32[index] = u;
    f32[index + 1] = v;
    u32[index + 2] = packing.argb;
    u32[index + 3] = packing.textureIdAndRound;
    f32[index + 4] = packing.flags;
    f32[index + 5] = packing.minU;
    f32[index + 6] = packing.minV;
    f32[index + 7] = packing.maxU;
    f32[index + 8] = packing.maxV;
    f32[index + 9] = packing.selection;
    f32[index + 10] = packing.blood;
    f32[index + 11] = packing.splash0;
    f32[index + 12] = packing.splash1;
    f32[index + 13] = packing.splash2;
    f32[index + 14] = packing.splash3;
    f32[index + 15] = packing.night;
    return index + WORLD_VERTEX_SIZE - 2;
  }

  /** The flags of an element whose texture is not paletted, though its page may be indexed (a cast
   *  silhouette or outline of an indexed body); the shadow lookups are skipped entirely while no shadow
   *  shading is compiled in. */
  function plainFlags(texture: Texture): number {
    const source = texture.source;
    const magnify = isMagnifiedTexture(texture) ? WORLD_FLAG_MAGNIFY : 0;
    const mipmapped = source.autoGenerateMipmaps || source.mipLevelCount > 1 ? WORLD_FLAG_MIPMAPPED : 0;
    const plain = (isIndexedSource(source) ? WORLD_FLAG_INDEXED : 0) | magnify | mipmapped;
    if (worldShadowStyle() === null || !isShadowTexture(texture)) return plain;
    return plain | WORLD_FLAG_SHADOW;
  }

  /** A recoloured stem's frame, which names its row, takes the plain page's magnification mark. */
  function recolouredFlags(texture: Texture, ownRow: number | undefined): number {
    if (ownRow === undefined) return 0;
    return WORLD_FLAG_RECOLOURED | (isMagnifiedTexture(texture) ? WORLD_FLAG_MAGNIFY : 0);
  }

  function palettedFlags(element: BatchableElement): number {
    const texture = element.texture;
    const ownRow = palettedRowOf(texture);
    return (
      WORLD_FLAG_PALETTED |
      WORLD_FLAG_INDEXED |
      recolouredFlags(texture, ownRow) |
      (glowOf(element) ? WORLD_FLAG_GLOW : 0) |
      (lutRowOf(element, ownRow) << WORLD_LUT_ROW_SHIFT)
    );
  }

  /** Notes what the whole pack of `element` is reading, after {@link beginElement}, for the next
   *  repack in place. */
  function notePacked(element: PackedQuadHost, sprite: object | null): PackedQuad {
    let packed = element[PACKED];
    if (packed === undefined) {
      packed = {
        sprite: null,
        viewTick: Number.NaN,
        a: 0,
        b: 0,
        c: 0,
        d: 0,
        shading: false,
        bounded: false,
        texelsX: 0,
        texelsY: 0,
      };
      element[PACKED] = packed;
    }
    const transform = element.transform;
    packed.sprite = sprite;
    packed.viewTick = movableViewTick(sprite);
    packed.a = transform.a;
    packed.b = transform.b;
    packed.c = transform.c;
    packed.d = transform.d;
    packed.shading = worldShadowStyle() !== null;
    packed.bounded = packing.selection >= 0 && gathers(packing.flags);
    packed.texelsX = 0;
    packed.texelsY = 0;
    if (!packed.bounded) return packed;
    const { minX, minY, maxX, maxY } = element.bounds;
    const texture = element.texture;
    if (element.roundPixels !== 0 || texture.rotate !== 0 || maxX <= minX || maxY <= minY) return packed;
    const source = texture.source;
    packed.texelsX = ((packing.maxU - packing.minU) * source.pixelWidth) / (maxX - minX);
    packed.texelsY = ((packing.maxV - packing.minV) * source.pixelHeight) / (maxY - minY);
    return packed;
  }

  /** Pixi's default batcher plus vertex attributes for what the fragment shader must know about the
   *  element's page: magnification, shadow shading, its palette LUT and row, and its frame's UV box. */
  class WorldBatcher extends Batcher {
    static extension = { type: [ExtensionType.Batcher], name: WORLD_BATCHER } as const;

    override geometry = worldBatchGeometry(
      new WorldAttributeBuffer({
        data: new Float32Array(1),
        label: 'world-batch-attributes',
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
      }),
      worldBatchIndices(),
    );
    override name = WorldBatcher.extension.name;
    override vertexSize = WORLD_VERTEX_SIZE;
    /** Served by the prototype accessor below; `declare` keeps it off the instance. */
    declare shader: Shader;
    /** Paletted elements packed by the running {@link break}, before their batch's texture list is final. */
    private readonly paletted: BatchableElement[] = [];
    private breaking = false;
    /** The LUT of the paletted elements added since the last {@link break}, once one is added. */
    private runLut: TextureSource | undefined;
    /** Where an added element reads another LUT than the paletted ones before it: each such element
     *  starts a run of its own, which Pixi splits further by pages. */
    private readonly lutRunStarts: number[] = [];
    /** Pages elements left since the last build, which their batches may still list. */
    private readonly leftPages = new Set<TextureSource>();
    /** The render group whose instructions this batcher builds; Pixi keeps one batcher per group. */
    private renderGroup: RenderGroup | null = null;
    /** The fewest page texels per render-group unit of any element packed since the last `begin` whose
     *  body may gather; an element repacked in place only lowers it. The still mesh's packer never
     *  begins, so its bound holds every quad it ever packed. */
    private texelsPerUnit = Number.POSITIVE_INFINITY;

    override updateElement(element: BatchableElement): void {
      const buffer = this.geometry.buffers[0];
      if (buffer instanceof WorldAttributeBuffer)
        buffer.changed(
          element._attributeStart * Float32Array.BYTES_PER_ELEMENT,
          element.attributeSize * this.vertexSize * Float32Array.BYTES_PER_ELEMENT,
        );
      if (!element.packAsQuad) {
        super.updateElement(element);
        return;
      }
      this.dirty = true;
      const attributes = this.attributeBuffer;
      this.repackQuad(
        element as DefaultBatchableQuadElement,
        attributes.float32View,
        attributes.uint32View,
        element._attributeStart,
        element._textureId,
      );
    }

    repackQuad(
      element: DefaultBatchableQuadElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number,
    ): void {
      if (!this.moveQuad(element, float32View, uint32View, index))
        this.packQuadAttributes(element, float32View, uint32View, index, textureId);
    }

    /**
     * Rewrites the corners and colour of a quad whose whole pack still stands at `index`, under whatever
     * transform it has now; false where something else that pack read has changed since, so the quad
     * needs packing whole.
     */
    private moveQuad(element: PackedQuadHost, f32: Float32Array, u32: Uint32Array, index: number): boolean {
      const packed = element[PACKED];
      if (packed === undefined) return false;
      const sprite = renderableOf(element);
      if (
        packed.sprite !== sprite ||
        packed.viewTick !== movableViewTick(sprite) ||
        packed.shading !== (worldShadowStyle() !== null)
      )
        return false;
      const { a, b, c, d, tx, ty } = element.transform;
      if (packed.a !== a || packed.b !== b || packed.c !== c || packed.d !== d) {
        packed.a = a;
        packed.b = b;
        packed.c = c;
        packed.d = d;
        this.noteTexelBound(packed);
      }
      const { minX, minY, maxX, maxY } = element.bounds;
      const argb = element.color;
      let i = index;
      f32[i] = a * minX + c * minY + tx;
      f32[i + 1] = d * minY + b * minX + ty;
      u32[i + COLOUR_AT] = argb;
      i += WORLD_VERTEX_SIZE;
      f32[i] = a * maxX + c * minY + tx;
      f32[i + 1] = d * minY + b * maxX + ty;
      u32[i + COLOUR_AT] = argb;
      i += WORLD_VERTEX_SIZE;
      f32[i] = a * maxX + c * maxY + tx;
      f32[i + 1] = d * maxY + b * maxX + ty;
      u32[i + COLOUR_AT] = argb;
      i += WORLD_VERTEX_SIZE;
      f32[i] = a * minX + c * maxY + tx;
      f32[i + 1] = d * maxY + b * minX + ty;
      u32[i + COLOUR_AT] = argb;
      return true;
    }

    /** Lowers {@link texelsPerUnit} to a gathering quad's bound under the transform `packed` holds. */
    private noteTexelBound(packed: PackedQuad): void {
      if (packed.bounded && this.texelsPerUnit > 0)
        this.texelsPerUnit = Math.min(this.texelsPerUnit, texelsPerUnitOf(packed));
    }

    /** Pixi always passes the renderer's texture limit; the batch program is compiled for at most
     *  {@link WORLD_BATCH_MAX_TEXTURES}, so a larger limit is capped. */
    constructor(options: BatcherOptions & { maxTextures: number }) {
      const slots = Math.min(options.maxTextures, WORLD_BATCH_MAX_TEXTURES);
      super({ ...options, maxTextures: slots - LUT_SLOTS });
    }

    /** The batch slot every LUT is bound at, past the page slots. */
    private get lutSlot(): number {
      return lutSlotOf(this.maxTextures + LUT_SLOTS);
    }

    /** Every element's flags. A paletted one packed during a {@link break} binds its LUT afterwards,
     *  once its batch's page list is final. */
    private flagsOf(element: BatchableElement): number {
      const texture = element.texture;
      if (palettedLutOf(texture) === undefined) return plainFlags(texture);
      if (this.breaking) this.paletted.push(element);
      return palettedFlags(element);
    }

    lutBinding(batch: Batch): LutBinding | null {
      const lut = batch.textures.textures[this.lutSlot];
      if (lut === null || lut === undefined || batch.textures.ids[lut.uid] !== this.lutSlot) return null;
      lutBinding ??= { lut, slot: 0, pages: 0 };
      lutBinding.lut = lut;
      lutBinding.slot = this.lutSlot;
      lutBinding.pages = this.pageCount(batch);
      return lutBinding;
    }

    /** Pages the batch lists: every slot below the LUT, which also fills the gap up to its own slot so
     *  the list has no holes. */
    private pageCount(batch: Batch): number {
      const { textures, ids, count } = batch.textures;
      const lut = textures[this.lutSlot];
      if (lut === null || lut === undefined || ids[lut.uid] !== this.lutSlot) return count;
      let pages = 0;
      while (pages < this.lutSlot && textures[pages] !== lut) pages++;
      return pages;
    }

    /**
     * An element changing page in place leaves the old page listed in its batch until the next rebuild,
     * and WebGL binds every listed page on every draw; binding a destroyed page throws. Swaps off a
     * destroyed page rebuild now, and a left page's later destruction rebuilds the render group.
     */
    override checkAndUpdateTexture(element: BatchableElement, texture: Texture): boolean {
      // A texture destroyed with its source no longer names that source.
      const left: TextureSource | null = element.texture.source;
      if (left === texture.source) return super.checkAndUpdateTexture(element, texture);
      if (left === null || left.destroyed) return false;
      if (!this.joinBatch(element, texture)) return false;
      this.watchLeftPage(left, element);
      return true;
    }

    override begin(): void {
      this.forgetLeftPages();
      this.texelsPerUnit = Number.POSITIVE_INFINITY;
      this.endLutRuns();
      super.begin();
    }

    override add(element: BatchableElement): void {
      const lut = palettedLutOf(element.texture);
      if (lut !== undefined) {
        if (this.runLut !== undefined && this.runLut !== lut) this.lutRunStarts.push(this.elementSize);
        this.runLut = lut;
      }
      super.add(element);
    }

    private endLutRuns(): void {
      this.runLut = undefined;
      this.lutRunStarts.length = 0;
    }

    /** The sampling the draw starting now needs: unmagnified while no element this batcher packed can be
     *  magnified, or null while none gathers, so either program draws it alike. */
    samplingNow(): WorldBatchSampling | null {
      if (this.texelsPerUnit === Number.POSITIVE_INFINITY) return null;
      return this.texelsPerUnit >= MAGNIFIED_BELOW * UNMAGNIFIED_MARGIN * drawPixelsPerUnit
        ? 'unmagnified'
        : 'magnifying';
    }

    override destroy(options?: { shader?: boolean }): void {
      this.forgetLeftPages();
      super.destroy(options);
    }

    private watchLeftPage(page: TextureSource, element: BatchableElement): void {
      const renderable = renderableOf(element);
      if (renderable instanceof Container) this.renderGroup = renderable.parentRenderGroup;
      if (this.leftPages.has(page)) return;
      this.leftPages.add(page);
      page.once('destroy', this.rebuildWithoutPage, this);
    }

    private rebuildWithoutPage(page: TextureSource): void {
      this.leftPages.delete(page);
      if (this.renderGroup !== null) this.renderGroup.structureDidChange = true;
    }

    private forgetLeftPages(): void {
      for (const page of this.leftPages) page.off('destroy', this.rebuildWithoutPage, this);
      this.leftPages.clear();
      this.renderGroup = null;
    }

    /** A texture whose page its batch lacks joins that batch while a page slot is free, so a walker
     *  stepping onto another atlas page re-packs one element instead of rebuilding its render group's
     *  instructions. WebGL binds a batch's texture list afresh on every draw, as {@link bindLut} relies on. */
    private joinBatch(element: BatchableElement, texture: Texture): boolean {
      if (super.checkAndUpdateTexture(element, texture)) return true;
      const batch = element._batch;
      const textures = batch.textures;
      const slot = this.pageCount(batch);
      if (slot >= this.maxTextures) return false;
      const lut = palettedLutOf(texture);
      if (lut !== undefined && !this.bindLut(batch, lut)) return false;
      textures.ids[texture.source.uid] = slot;
      textures.textures[slot] = texture.source;
      if (slot >= textures.count) textures.count = slot + 1;
      element._textureId = slot;
      element.texture = texture;
      return true;
    }

    /** Pixi lists a batch's pages in the order its elements first use them, contiguous from slot 0,
     *  which `bindWorldBatchPagesAndLut` relies on. Keeping a page in one slot across batches cut binds
     *  by a third but cost 2 to 13% GPU time. Each LUT run of the added elements breaks on its own, so
     *  a batch never meets a second LUT. */
    override break(instructionSet: InstructionSet): void {
      const end = this.elementSize;
      const firstBatch = this.batchIndex;
      this.breaking = true;
      try {
        for (const runStart of this.lutRunStarts) {
          this.elementSize = runStart;
          this.breakRun(instructionSet, firstBatch);
        }
        this.elementSize = end;
        this.breakRun(instructionSet, firstBatch);
      } finally {
        this.elementSize = end;
        this.breaking = false;
        this.endLutRuns();
      }
      for (const element of this.paletted) {
        const lut = palettedLutOf(element.texture);
        if (lut !== undefined && !this.bindLut(element._batch, lut)) {
          throw new Error('A world batch holds one palette LUT');
        }
      }
      this.paletted.length = 0;
    }

    /** Breaks the added elements up to `elementSize`. A run after the first continues the draws its
     *  break started, with the program and geometry still bound, as a batch Pixi splits for pages does. */
    private breakRun(instructionSet: InstructionSet, firstBatch: number): void {
      const run = this.batchIndex;
      super.break(instructionSet);
      const batch = this.batches[run];
      if (run > firstBatch && run < this.batchIndex && batch !== undefined) batch.action = 'renderBatch';
    }

    /** Lists `lut` at the batch's LUT slot, filling the page slots up to it with the LUT as well so the
     *  list has no holes; false when the batch already holds another LUT. */
    private bindLut(batch: Batch, lut: TextureSource): boolean {
      const textures = batch.textures;
      const slot = this.lutSlot;
      if (textures.ids[lut.uid] === slot) return true;
      if (textures.count > slot) return false;
      for (let free = textures.count; free <= slot; free++) textures.textures[free] = lut;
      textures.ids[lut.uid] = slot;
      textures.count = slot + LUT_SLOTS;
      return true;
    }

    packAttributes(
      element: DefaultBatchableMeshElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number,
    ): void {
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xffff);
      beginRenderable(renderableOf(element));
      beginElement(element.texture, textureIdAndRound, element.color, this.flagsOf(element));
      // A mesh's vertices may stretch its texels anywhere.
      if (packing.selection >= 0 && gathers(packing.flags)) this.texelsPerUnit = 0;
      const { a, b, c, d, tx, ty } = element.transform;
      const { positions, uvs } = element;
      const end = element.attributeOffset + element.attributeSize;
      for (let i = element.attributeOffset; i < end; i++) {
        const i2 = i * 2;
        const x = positions[i2] ?? 0;
        const y = positions[i2 + 1] ?? 0;
        float32View[index++] = a * x + c * y + tx;
        float32View[index++] = d * y + b * x + ty;
        index = packVertex(float32View, uint32View, index, uvs[i2] ?? 0, uvs[i2 + 1] ?? 0);
      }
    }

    /** Runs for every quad of the sprite layer on each rebuild, so it writes the four corners inline. */
    packQuadAttributes(
      element: DefaultBatchableQuadElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number,
    ): void {
      const texture = element.texture;
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xffff);
      const renderable = renderableOf(element);
      const outline = beginRenderable(renderable);
      beginElement(texture, textureIdAndRound, element.color, this.flagsOf(element));
      this.noteTexelBound(notePacked(element, renderable));
      if (outline !== null) packOutline(outline);
      const { a, b, c, d, tx, ty } = element.transform;
      const { minX, minY, maxX, maxY } = element.bounds;
      const uvs = texture.uvs;
      let i = index;
      float32View[i++] = a * minX + c * minY + tx;
      float32View[i++] = d * minY + b * minX + ty;
      i = packVertex(float32View, uint32View, i, uvs.x0, uvs.y0);
      float32View[i++] = a * maxX + c * minY + tx;
      float32View[i++] = d * minY + b * maxX + ty;
      i = packVertex(float32View, uint32View, i, uvs.x1, uvs.y1);
      float32View[i++] = a * maxX + c * maxY + tx;
      float32View[i++] = d * maxY + b * maxX + ty;
      i = packVertex(float32View, uint32View, i, uvs.x2, uvs.y2);
      float32View[i++] = a * minX + c * maxY + tx;
      float32View[i++] = d * maxY + b * minX + ty;
      packVertex(float32View, uint32View, i, uvs.x3, uvs.y3);
    }
  }

  // `shader` is read per batch execution; resolving it from the current mode there means a live
  // setting change takes effect on the next frame. Pixi's base class never assigns the property.
  Object.defineProperty(WorldBatcher.prototype, 'shader', {
    get(this: WorldBatcher) {
      const mode = pixelArtMagnifyMode();
      // A draw that may take either program keeps the one bound, saving a program switch.
      const sampling: WorldBatchSampling =
        mode === WORLD_MAGNIFY_MODES.off
          ? 'magnifying'
          : (this.samplingNow() ?? lastShader?.sampling ?? 'magnifying');
      return shaderFor(this.maxTextures + LUT_SLOTS, mode, worldShadowStyle(), sampling);
    },
    set() {}, // Pixi's base class never assigns it; the mode owns the choice
  });

  return WorldBatcher;
}

/** Register the `world` batcher; call before the first world sprite is batched. Idempotent. */
export function installWorldBatcher(): WorldBatcherClass {
  worldBatcherClass ??= defineWorldBatcher();
  extensions.add(worldBatcherClass);
  return worldBatcherClass;
}
