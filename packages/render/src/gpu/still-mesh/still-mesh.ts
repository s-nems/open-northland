import {
  Batch,
  type BatchableElement,
  type BatchableSprite,
  Batcher,
  Buffer,
  BufferUsage,
  type Container,
  type Geometry,
  getAdjustedBlendModeBlend,
  type InstructionSet,
  type Renderer,
  RendererType,
  type RenderLayer,
  type Shader,
  Sprite,
  type Texture,
  type TextureSource,
  ViewContainer,
  type WebGLRenderer,
} from 'pixi.js';
import { worldShadowStyle } from '../pixel-art/registry.js';
import {
  installWorldBatcher,
  isWorldBatched,
  type LutBinding,
  type LutListingBatcher,
  lutSlotOf,
  WORLD_VERTEX_SIZE,
  worldBatchGeometry,
} from '../world-batch/batcher.js';
import { LUT_SLOTS } from '../world-batch/shader.js';
import { DrawTable, type TableQuad } from './draw-table.js';
import { type ByteUploader, QuadStore, VERTICES_PER_QUAD } from './quad-store.js';

/**
 * The pooled sprites of the depth-sorted layer, drawn from one retained mesh instead of Pixi's batches.
 *
 * A band rebuild walks its children in painter order as Pixi would. A child the owner offers has its
 * sprites' quads in stable slots of a shared attribute buffer: the rebuild writes only their indices, and
 * each maximal run of such children between two others becomes one draw of the world batch program,
 * placed in the band's instructions where Pixi's own batches of that run would have been. A run's draws
 * split where its pages or palette LUT outgrow one draw's texture list, as Pixi's batches do; a rebuild
 * that moves a quad to another texture slot rewrites only that slot's id. A meshed sprite's batch record
 * names this mesh as its batcher, so Pixi's own update path (a transform, tint, palette row or texture
 * change between rebuilds) repacks its slot in place, and a page that does not fit asks Pixi for a rebuild
 * exactly as a full batch does. Packed quads upload once per render, as the first mesh draw binds.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: a render group root collects
 * through `collectRenderablesSimple`; the sprite pipe's `_getGpuSprite` and `_updateBatchableSprite` mint
 * and refresh a sprite's batch record; updates reach the record's `_batcher.updateElement` and
 * `checkAndUpdateTexture` unless the group is rebuilding that frame; the `batch` pipe draws any `Batch`
 * from its batcher's geometry and shader with its texture list bound, reading that geometry after every
 * group of the render has updated; and every batch after a `break` has `action === 'startBatch'`, so Pixi
 * rebinds its own geometry and shader after a mesh draw.
 */

/** `globalDisplayStatus` of a container Pixi collects: visible, renderable and not culled. */
const DISPLAYED = 0b111;
export const INDICES_PER_QUAD = 6;
const INITIAL_BAND_INDICES = 1024;
/**
 * Quad packs a run of mesh children must save per frame, on average, before it draws from the mesh: a
 * run costs two draws every frame (its own and the Pixi batch it splits), about what Pixi spends packing
 * two quads on a rebuild. A run qualifies when its quads times its band's rebuilds per frame reach this.
 * Measured in one session alternating the settings, x3 at 1440x900:
 * - Held stills only, magiczny_las t120000, 4x CPU throttle: 2 beat 8 and 16 at zoom 0.35 (`app.render`
 *   25.9 ms against 26.2 and 27.3) and stayed within noise of no mesh at zoom 1.
 * - With the walkers meshed, magiczny_las t100000, two 4 s phases each: `app.render` at zoom 0.35 and 4x
 *   was 40.4, 42.1, 36.7 and 40.3 ms for 0, 1, 2 and 4, within the phases' spread, and 3.36 to 3.45 ms
 *   unthrottled. Paused at zoom 0.35, 0, which never hands a quiet band back to Pixi, drew 511 calls; 1, 2
 *   and 4 drew 412 to 415.
 * 2 stays: it beat the larger payoffs, and no smaller one measured better.
 */
const RUN_PAYOFF = 2;
/** Weight of the latest rebuild interval in a band's running estimate. */
const INTERVAL_WEIGHT = 0.25;
/** A band's estimated frames between rebuilds before it has rebuilt: it meshes nothing until its own
 *  rebuilds show it is worth it. */
const INITIAL_INTERVAL = 64;
/** A quad its last two packs came at most this many renders apart is hot: it moves to a hot block of the
 *  store at its band's next rebuild, so the quads repacked every few frames upload together. */
const HOT_REPACK_RENDERS = 16;
/** A quad left unpacked this long is cold again, and moves back at its band's next rebuild. */
const COOL_RENDERS = 240;

/** A band's interval estimate after a rebuild `elapsed` renders after its last. */
function nextInterval(interval: number, elapsed: number): number {
  return interval + (elapsed - interval) * INTERVAL_WEIGHT;
}

/** Whether a run of `quads` draws from the mesh at a band's `interval` estimate. */
function runPays(quads: number, interval: number, runPayoff: number): boolean {
  return quads >= runPayoff * Math.max(1, interval);
}

/**
 * Renders after a rebuild at which the next one would leave a run of `quads` to Pixi: the first elapsed
 * count that lifts the estimate past `quads / runPayoff`. The closed form can land one render off either
 * way through float rounding, so the rebuild's own test settles it.
 */
export function quietRebuildAfter(interval: number, quads: number, runPayoff: number): number {
  const paidInterval = quads / runPayoff;
  let elapsed = Math.floor(interval + (paidInterval - interval) / INTERVAL_WEIGHT) + 1;
  while (elapsed > 1 && !runPays(quads, nextInterval(interval, elapsed - 1), runPayoff)) elapsed--;
  while (runPays(quads, nextInterval(interval, elapsed), runPayoff)) elapsed++;
  return elapsed;
}
/** A displayed child's place in a rebuild: drawn by Pixi, or a candidate for the mesh. */
const PIXI = 0;
const MESH = 1;
const HIDDEN = 2;
/** The member record a meshed child carries, keyed off the container itself to spare a map lookup per
 *  child per rebuild. */
const MEMBER: unique symbol = Symbol('still mesh member');
type MemberHost = Container & { [MEMBER]?: Member };

interface SpritePipeInternals {
  _getGpuSprite(sprite: Sprite): BatchableSprite;
  _updateBatchableSprite(sprite: Sprite, element: BatchableSprite): void;
}

/** One sprite of a meshed child: its batch record and the slot its quad lives in. */
interface MeshQuad extends TableQuad {
  readonly sprite: Sprite;
  readonly element: BatchableSprite;
  /** Moves between the store's cold and hot blocks only as its band rebuilds, which rewrites its index. */
  slot: number;
  /** The renders it was last packed on, and the one before. */
  packFrame: number;
  previousPackFrame: number;
  /** The sprite's change ticks when its quad was last packed. */
  containerTick: number;
  viewTick: number;
  /** The table its draw binds and the slot of its page there. */
  table: DrawTable | null;
  textureId: number;
  live: boolean;
}

/** A meshed child of a band and the quads of its drawn sprites, in Pixi's collect order. */
interface Member {
  readonly container: Container;
  quads: MeshQuad[];
  /** The band whose last rebuild drew it from the mesh, and that rebuild's number. */
  band: BandStills | null;
  build: number;
  /** The plain containers nested in it whose sprites it draws, as its last reshape found them. */
  nested: Container[];
  /** The change ticks of the container and its nested ones, summed, and the shading its quads were packed
   *  under. Ticks only rise, so a sum moves whenever one of its ticks does. */
  containerTick: number;
  viewTick: number;
  shading: boolean;
  /** Whether the running rebuild repacks every quad: the container moved or its sprites changed. */
  moved: boolean;
}

/** Whether Pixi would collect `c` at all: a hidden or culled child adds nothing to the instructions. */
function displayed(c: Container, layer: RenderLayer): boolean {
  return (
    (c.parentRenderLayer === null || c.parentRenderLayer === layer) &&
    c.globalDisplayStatus >= DISPLAYED &&
    c.includeInBuild
  );
}

/** A texture the world batch draws through its page, and a paletted one through its LUT, with the plain
 *  blend: what a slot carries. */
function meshableTexture(texture: Texture): boolean {
  const source: TextureSource | null = texture.source;
  return source !== null && !source.destroyed && getAdjustedBlendModeBlend('normal', source) === 'normal';
}

/** A plain world-batched sprite Pixi packs as one quad of the world batch. */
function meshableSprite(child: Container): child is Sprite {
  return (
    child instanceof Sprite &&
    child.renderPipeId === 'sprite' &&
    child.children.length === 0 &&
    (child.effects?.length ?? 0) === 0 &&
    child.renderGroup === null &&
    child.groupBlendMode === 'normal' &&
    isWorldBatched(child) &&
    meshableTexture(child.texture)
  );
}

/** A container Pixi collects by walking its children in order, with nothing drawn of its own. */
function plainContainer(child: Container): boolean {
  return (
    !(child instanceof ViewContainer) &&
    child.renderGroup === null &&
    (child.effects?.length ?? 0) === 0 &&
    !child.sortableChildren
  );
}

/** A plain container inside a member, such as a selection outline's: Pixi collects its sprites in place
 *  among the member's own, so the mesh does too. */
function nestedGroup(child: Container): boolean {
  return plainContainer(child) && child.groupBlendMode === 'normal';
}

/** Push `container`'s displayed sprites in Pixi's collect order, and its nested groups; false at a
 *  displayed child the mesh cannot draw. */
function collectSprites(
  container: Container,
  layer: RenderLayer,
  sprites: Sprite[],
  nested: Container[],
): boolean {
  for (const child of container.children) {
    if (!displayed(child, layer)) continue;
    if (nestedGroup(child)) {
      nested.push(child);
      if (!collectSprites(child, layer, sprites, nested)) return false;
    } else if (meshableSprite(child)) sprites.push(child);
    else return false;
  }
  return true;
}

/**
 * Match `container`'s displayed sprites, nested groups included, against `quads` from `next` on: the index
 * past them, or -1 where one is not its quad's sprite, or changed and is no longer meshable.
 */
function holdsFrom(
  container: Container,
  quads: readonly MeshQuad[],
  next: number,
  layer: RenderLayer,
): number {
  let at = next;
  for (const child of container.children) {
    if (!displayed(child, layer)) continue;
    if (nestedGroup(child)) {
      at = holdsFrom(child, quads, at, layer);
      if (at < 0) return -1;
      continue;
    }
    const quad = quads[at++];
    if (quad === undefined || quad.sprite !== child || !quad.live) return -1;
    const changed =
      quad.containerTick !== child._didContainerChangeTick || quad.viewTick !== child._didViewChangeTick;
    if (changed && !meshableSprite(child)) return -1;
  }
  return at;
}

function containerTicksOf(member: Member): number {
  let ticks = member.container._didContainerChangeTick;
  for (const group of member.nested) ticks += group._didContainerChangeTick;
  return ticks;
}

function viewTicksOf(member: Member): number {
  let ticks = member.container._didViewChangeTick;
  for (const group of member.nested) ticks += group._didViewChangeTick;
  return ticks;
}

/**
 * One band's share of the mesh: its geometry over the shared slots, its draws' texture tables, and the
 * draws its last rebuild placed. The batcher is the record every meshed sprite of the band names, so
 * Pixi's updates reach the mesh; its geometry and shader are what the band's draws bind.
 */
class BandStills extends Batcher implements LutListingBatcher {
  override name = 'stillMesh';
  protected override vertexSize = WORLD_VERTEX_SIZE;
  declare geometry: Geometry;
  declare shader: Shader;
  private readonly ownGeometry: Geometry;
  /** The tables the last rebuild filled, in painter order; the last of them takes the next quads. */
  private readonly tables: DrawTable[] = [];
  private tableCount = 0;
  readonly bandIndices: Buffer;
  indices = new Uint32Array(INITIAL_BAND_INDICES);
  indexCount = 0;
  readonly draws: Batch[] = [];
  drawCount = 0;
  members: Member[] = [];
  spareMembers: Member[] = [];
  build = 0;
  /** The render this band last rebuilt on, and its running estimate of renders between rebuilds. */
  lastBuildFrame = -1;
  interval = INITIAL_INTERVAL;
  /** Quads of the largest run the last rebuild meshed, and the render from which the next rebuild's
   *  estimate would leave even that run to Pixi. */
  largestRun = 0;
  quietFrame = Number.POSITIVE_INFINITY;
  /** Per child of the running rebuild: {@link PIXI}, {@link MESH} or {@link HIDDEN}. */
  classes = new Uint8Array(0);
  /** Pages and LUTs a table of the band took on, each watched for its destruction. */
  private readonly watched = new Set<TextureSource>();
  private readonly watch = (source: TextureSource): void => {
    if (this.watched.has(source)) return;
    this.watched.add(source);
    source.once('destroy', this.pageDied, this);
  };
  /** Where a draw binds its table's LUT: past every page slot. */
  private readonly lutSlot: number;
  private binding: LutBinding | null = null;

  constructor(
    readonly band: Container,
    private readonly mesh: StillSpriteMesh,
    store: QuadStore,
    packer: Batcher,
  ) {
    super({
      maxTextures: packer.maxTextures,
      attributesInitialSize: 4,
      indicesInitialSize: INDICES_PER_QUAD,
    });
    this.lutSlot = lutSlotOf(packer.maxTextures + LUT_SLOTS);
    this.bandIndices = new Buffer({
      data: this.indices,
      label: 'still-mesh-indices',
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
    const geometry = worldBatchGeometry(store.buffer, this.bandIndices);
    this.ownGeometry = geometry;
    // The batch pipe reads this as a draw binds it, after the render's updates: packed quads upload then.
    Object.defineProperty(this, 'geometry', {
      get: () => {
        mesh.uploadPacked();
        return geometry;
      },
    });
    Object.defineProperty(this, 'shader', { get: () => packer.shader });
  }

  /** The table taking the running rebuild's quads; null before its first member. */
  get table(): DrawTable | null {
    return this.tables[this.tableCount - 1] ?? null;
  }

  /** Start the rebuild's tables over. */
  beginTables(): void {
    this.tableCount = 0;
  }

  /** The next table for the quads from here on, after the ones the running rebuild filled: the one in
   *  that place last rebuild, so its pages keep their slots where they still fit. */
  openTable(): DrawTable {
    let table = this.tables[this.tableCount];
    if (table === undefined) {
      table = new DrawTable(this.maxTextures, this.watch);
      this.tables.push(table);
    }
    this.tableCount++;
    table.begin();
    return table;
  }

  /** End the rebuild's fill of every table it used. */
  finishTables(): void {
    for (let i = 0; i < this.tableCount; i++) this.tables[i]?.finish();
  }

  lutBinding(batch: Batch): LutBinding | null {
    const table = batch.textures;
    if (!(table instanceof DrawTable) || table.lut === null) return null;
    this.binding ??= { lut: table.lut, slot: this.lutSlot, pages: 0 };
    this.binding.lut = table.lut;
    this.binding.pages = table.count;
    return this.binding;
  }

  /** A destroyed page or LUT must leave the tables before the band draws again. */
  private pageDied(source: TextureSource): void {
    this.watched.delete(source);
    this.band.renderGroup.structureDidChange = true;
  }

  reserveIndices(count: number): void {
    if (count <= this.indices.length) return;
    const grown = new Uint32Array(Math.max(count, this.indices.length * 2));
    grown.set(this.indices.subarray(0, this.indexCount));
    this.indices = grown;
  }

  override checkAndUpdateTexture(element: BatchableElement, texture: Texture): boolean {
    return this.mesh.retexture(element, texture);
  }

  override updateElement(element: BatchableElement): void {
    this.mesh.repack(this, element);
  }

  override packAttributes(): void {
    throw new Error('the still mesh packs quads only');
  }

  override packQuadAttributes(): void {
    throw new Error('the still mesh packs through the world batcher');
  }

  /** Frees the band's own buffers; the attribute buffer is the mesh's. Never batched, so Pixi's batch
   *  teardown has nothing to return. */
  override destroy(): void {
    for (const source of this.watched) source.off('destroy', this.pageDied, this);
    this.watched.clear();
    for (const table of this.tables) table.clear();
    this.ownGeometry.destroy(false);
    this.bandIndices.destroy();
    this.attributeBuffer.destroy();
  }
}

/** Instruction-building calls of a depth band, delegated to the mesh. */
export interface StillBandCollector {
  /** Collect `band`'s children into `instructionSet`; false leaves the band to Pixi's own collect. */
  collectBand(
    band: Container,
    instructionSet: InstructionSet,
    renderer: Renderer,
    layer: RenderLayer,
  ): boolean;
  /** Per render, before any band builds. */
  beforeRender(): void;
  destroy(): void;
}

export class StillSpriteMesh implements StillBandCollector {
  private renderer: WebGLRenderer | null = null;
  private packer: Batcher | null = null;
  private store: QuadStore | null = null;
  private readonly bands = new Map<Container, BandStills>();
  /** Bands whose last rebuild drew from the mesh: each rebuilds once it goes quiet for long enough. */
  private readonly meshing = new Set<BandStills>();
  private readonly quads = new WeakMap<BatchableElement, MeshQuad>();
  /** Whether shadow shading is compiled in, which a shadow page's packed flags depend on. */
  private shading = worldShadowStyle() !== null;
  /** Renders so far, the clock of the bands' rebuild rates. */
  private frame = 0;
  /** {@link reshape}'s scratch list of the sprites Pixi would collect. */
  private readonly reshaped: Sprite[] = [];
  private readonly upload: ByteUploader = (buffer, offset, size) => {
    buffer.update(size, offset);
    this.renderer?.buffer.updateBuffer(buffer);
  };

  /**
   * @param offered whether the owner offers `child` to the mesh, whose sprites then draw from it where
   *   they can.
   * @param runPayoff the quad packs per frame a run must save to draw from the mesh ({@link RUN_PAYOFF}).
   */
  constructor(
    private readonly offered: (child: Container) => boolean,
    private readonly runPayoff = RUN_PAYOFF,
  ) {}

  /** Meshed quads, for tests and tools. */
  get quadCount(): number {
    return this.store?.size ?? 0;
  }

  beforeRender(): void {
    this.frame++;
    // A render that drew no mesh left its packs queued; this bounds the queue to one render's.
    this.uploadPacked();
    // A meshed run splits the batches around it every render but saves packs only when its band
    // rebuilds. A band that stopped rebuilding (a camera at rest, a paused game) rebuilds once more, so
    // its estimate hands those runs back to Pixi's fewer draws.
    for (const state of this.meshing) {
      if (this.frame < state.quietFrame) continue;
      this.meshing.delete(state);
      state.band.renderGroup.structureDidChange = true;
    }
    const shading = worldShadowStyle() !== null;
    if (shading === this.shading) return;
    this.shading = shading;
    for (const state of this.bands.values())
      if (state.members.length > 0) state.band.renderGroup.structureDidChange = true;
  }

  collectBand(
    band: Container,
    instructionSet: InstructionSet,
    renderer: Renderer,
    layer: RenderLayer,
  ): boolean {
    const state = this.stateFor(band, renderer);
    if (state === null) return false;
    const store = this.store;
    if (store === null) return false;
    state.build++;
    const children = band.children as MemberHost[];
    this.classify(state, children, layer);
    state.indexCount = 0;
    state.drawCount = 0;
    state.beginTables();
    const previous = state.members;
    state.members = state.spareMembers;
    state.members.length = 0;
    const classes = state.classes;
    let runStart = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const kind = classes[i];
      if (child === undefined || kind === HIDDEN) continue;
      let member = kind === MESH ? this.meshMember(state, child, layer) : null;
      if (member !== null && state.table?.fits(member.quads) !== true) {
        // The run so far draws through the full table; the member starts the next draw on a fresh one.
        this.closeRun(state, instructionSet, renderer, runStart);
        runStart = state.indexCount;
        if (!state.openTable().fits(member.quads)) member = this.reject(state, member);
      }
      if (member === null) {
        this.closeRun(state, instructionSet, renderer, runStart);
        runStart = state.indexCount;
        child.collectRenderables(instructionSet, renderer, layer);
        continue;
      }
      this.place(state, member);
      state.members.push(member);
      state.reserveIndices(state.indexCount + member.quads.length * INDICES_PER_QUAD);
      const indices = state.indices;
      let at = state.indexCount;
      for (const quad of member.quads) {
        const first = quad.slot * VERTICES_PER_QUAD;
        indices[at++] = first;
        indices[at++] = first + 1;
        indices[at++] = first + 2;
        indices[at++] = first;
        indices[at++] = first + 2;
        indices[at++] = first + 3;
      }
      state.indexCount = at;
    }
    this.closeRun(state, instructionSet, renderer, runStart);
    state.finishTables();
    for (const member of previous)
      if (member.band === state && member.build !== state.build) this.drop(member);
    previous.length = 0;
    state.spareMembers = previous;
    if (state.indexCount > 0) state.bandIndices.setDataWithSize(state.indices, state.indexCount, true);
    this.watchQuiet(state);
    return true;
  }

  /** Schedule `state`'s quiet rebuild: the first render at which a rebuild would leave its largest
   *  meshed run to Pixi. */
  private watchQuiet(state: BandStills): void {
    if (state.drawCount === 0 || this.runPayoff <= 0) {
      this.meshing.delete(state);
      return;
    }
    state.quietFrame =
      state.lastBuildFrame + quietRebuildAfter(state.interval, state.largestRun, this.runPayoff);
    this.meshing.add(state);
  }

  private forgetBand(band: Container): void {
    const state = this.bands.get(band);
    if (state === undefined) return;
    this.meshing.delete(state);
    for (const member of state.members) if (member.band === state) this.drop(member);
    state.members.length = 0;
    state.destroy();
    this.bands.delete(band);
  }

  destroy(): void {
    for (const band of [...this.bands.keys()]) this.forgetBand(band);
    this.store?.destroy();
    this.store = null;
    this.packer?.destroy();
    this.packer = null;
    this.renderer = null;
  }

  /** Upload every quad packed since the last upload, before a mesh draw binds the shared buffer. */
  uploadPacked(): void {
    this.store?.flush(this.upload);
  }

  /** Pixi repacks a meshed sprite of `state` between rebuilds: write its slot for the next upload. */
  repack(state: BandStills, element: BatchableElement): void {
    const quad = this.quads.get(element);
    const store = this.store;
    if (quad === undefined || !quad.live || store === null || this.packer === null) return;
    // A sprite changing under a child the owner no longer offers: its band rebuilds and hands it to Pixi.
    const owner = quad.sprite.parent;
    if (owner === null || !this.offered(owner)) state.band.renderGroup.structureDidChange = true;
    this.packer.packQuadAttributes(
      quad.element,
      store.f32,
      store.u32,
      QuadStore.start(quad.slot),
      quad.textureId,
    );
    quad.containerTick = quad.sprite._didContainerChangeTick;
    quad.viewTick = quad.sprite._didViewChangeTick;
    quad.previousPackFrame = quad.packFrame;
    quad.packFrame = this.frame;
    store.markDirty(quad.slot);
  }

  /** Pixi asks whether a meshed sprite's new texture still draws from its draw's texture table. */
  retexture(element: BatchableElement, texture: Texture): boolean {
    const quad = this.quads.get(element);
    if (quad === undefined || !quad.live || quad.table === null || !meshableTexture(texture)) return false;
    // Pixi asks with the sprite's own new texture, which the quad reads.
    const id = quad.table.join(quad);
    if (id === null) return false;
    quad.textureId = id;
    element._textureId = id;
    element.texture = texture;
    return true;
  }

  private stateFor(band: Container, renderer: Renderer): BandStills | null {
    if (renderer.type !== RendererType.WEBGL) return null;
    if (this.renderer === null) {
      this.renderer = renderer as WebGLRenderer;
      const World = installWorldBatcher();
      this.packer = new World({ maxTextures: renderer.limits.maxBatchableTextures });
      this.store = new QuadStore();
    }
    if (this.renderer !== renderer || this.packer === null || this.store === null) return null;
    let state = this.bands.get(band);
    if (state === undefined) {
      state = new BandStills(band, this, this.store, this.packer);
      this.bands.set(band, state);
    }
    return state;
  }

  /**
   * Sort `children` into Pixi's and the mesh's for this rebuild: an offered child joins the mesh only
   * within a run of offered children whose quads, at the band's rebuild rate, pay for the run's draws.
   */
  private classify(state: BandStills, children: readonly MemberHost[], layer: RenderLayer): void {
    const elapsed = state.lastBuildFrame < 0 ? INITIAL_INTERVAL : this.frame - state.lastBuildFrame;
    state.lastBuildFrame = this.frame;
    state.interval = nextInterval(state.interval, elapsed);
    const n = children.length;
    if (state.classes.length < n) state.classes = new Uint8Array(Math.max(n, state.classes.length * 2));
    const classes = state.classes;
    for (let i = 0; i < n; i++) {
      const child = children[i];
      classes[i] =
        child === undefined || !displayed(child, layer) ? HIDDEN : this.offered(child) ? MESH : PIXI;
    }
    // A hidden child adds nothing to the instructions, so it does not split a run.
    state.largestRun = 0;
    for (let i = 0; i < n; ) {
      if (classes[i] !== MESH) {
        i++;
        continue;
      }
      let end = i;
      let quads = 0;
      for (; end < n && classes[end] !== PIXI; end++)
        if (classes[end] === MESH) quads += children[end]?.children.length ?? 0;
      if (runPays(quads, state.interval, this.runPayoff))
        state.largestRun = Math.max(state.largestRun, quads);
      else for (let k = i; k < end; k++) if (classes[k] === MESH) classes[k] = PIXI;
      i = end;
    }
  }

  /** End the run of meshed quads since `start`: one draw between the Pixi batches around it. */
  private closeRun(
    state: BandStills,
    instructionSet: InstructionSet,
    renderer: Renderer,
    start: number,
  ): void {
    const size = state.indexCount - start;
    if (size === 0) return;
    renderer.renderPipes.batch.break(instructionSet);
    const table = state.table;
    if (table === null) return;
    let draw = state.draws[state.drawCount];
    if (draw === undefined) {
      draw = new Batch();
      draw.batcher = state;
      draw.blendMode = 'normal';
      draw.topology = 'triangle-list';
      state.draws.push(draw);
    }
    state.drawCount++;
    draw.textures = table;
    draw.action = 'startBatch';
    draw.start = start;
    draw.size = size;
    instructionSet.add(draw);
  }

  /**
   * `child` as a member of `state`'s mesh, its quads matched to the sprites it draws; null when a sprite
   * of it cannot draw from the mesh.
   */
  private meshMember(state: BandStills, child: MemberHost, layer: RenderLayer): Member | null {
    let member = child[MEMBER];
    if (member === undefined) {
      member = {
        container: child,
        quads: [],
        nested: [],
        band: null,
        build: 0,
        containerTick: Number.NaN,
        viewTick: Number.NaN,
        shading: this.shading,
        moved: true,
      };
      child[MEMBER] = member;
    }
    // A child added or removed moves the view tick and may change the sprites; a transform, tint or alpha
    // change moves the container tick, which moves every sprite of it, so all its quads repack.
    const regrouped = member.band === null || member.viewTick !== viewTicksOf(member);
    const moved =
      regrouped || member.containerTick !== containerTicksOf(member) || member.shading !== this.shading;
    const shaped = regrouped
      ? this.reshape(member, layer)
      : (plainContainer(child) && child.groupBlendMode === 'normal' && this.shapeHolds(member, layer)) ||
        this.reshape(member, layer);
    if (!shaped) return this.reject(state, member);
    member.moved = moved;
    return member;
  }

  /**
   * Draw `member` through `state`'s current table, which it fits: pack each quad whose sprite changed
   * since it was last packed, and point the others at their page's slot there.
   */
  private place(state: BandStills, member: Member): void {
    const table = state.table;
    const store = this.store;
    if (table === null || store === null) return;
    for (const quad of member.quads) {
      const sprite = quad.sprite;
      const id = table.join(quad);
      if (id === null) throw new Error('A still-mesh member was placed past its table');
      const current =
        !member.moved &&
        quad.containerTick === sprite._didContainerChangeTick &&
        quad.viewTick === sprite._didViewChangeTick;
      if (this.frame - quad.packFrame > COOL_RENDERS) this.settle(quad, false, current);
      else if (quad.packFrame - quad.previousPackFrame <= HOT_REPACK_RENDERS)
        this.settle(quad, true, current);
      if (!current) this.pack(state, quad, id);
      else if (quad.textureId !== id) {
        store.retarget(quad.slot, id);
        quad.textureId = id;
        quad.element._textureId = id;
      }
      quad.table = table;
      quad.element._batcher = state;
      // Pixi clears this as it collects a view, so the sprite's next change notifies the group again.
      if (sprite.didViewUpdate) sprite.didViewUpdate = false;
    }
    member.band = state;
    member.build = state.build;
    member.containerTick = containerTicksOf(member);
    member.viewTick = viewTicksOf(member);
    member.shading = this.shading;
  }

  /**
   * Whether `member`'s quads are still the sprites Pixi would collect of it, in order, and each one that
   * changed still meshable. A sprite hidden, shown, re-blended or inserted with `addChildAt` moves no tick
   * of the container.
   */
  private shapeHolds(member: Member, layer: RenderLayer): boolean {
    return holdsFrom(member.container, member.quads, 0, layer) === member.quads.length;
  }

  /** Match `member`'s quads to the sprites Pixi would collect of it now; false if one cannot be meshed. */
  private reshape(member: Member, layer: RenderLayer): boolean {
    if (!plainContainer(member.container)) return false;
    const sprites = this.reshaped;
    sprites.length = 0;
    member.nested.length = 0;
    if (!collectSprites(member.container, layer, sprites, member.nested)) return false;
    const store = this.store;
    const renderer = this.renderer;
    if (store === null || renderer === null) return false;
    const pipe = renderer.renderPipes.sprite as unknown as SpritePipeInternals;
    const kept: MeshQuad[] = [];
    let next = 0;
    for (const sprite of sprites) {
      const old = member.quads[next];
      if (old !== undefined && old.sprite === sprite && old.live) {
        kept.push(old);
        next++;
        continue;
      }
      const quad: MeshQuad = {
        sprite,
        element: pipe._getGpuSprite(sprite),
        slot: store.allocate(),
        containerTick: Number.NaN,
        viewTick: Number.NaN,
        packFrame: Number.NEGATIVE_INFINITY,
        previousPackFrame: Number.NEGATIVE_INFINITY,
        table: null,
        textureId: -1,
        live: true,
        lutTexture: null,
        lut: undefined,
      };
      this.quads.set(quad.element, quad);
      kept.push(quad);
    }
    for (const quad of member.quads) if (!kept.includes(quad)) this.free(quad);
    member.quads = kept;
    return true;
  }

  /** Move `quad` to a block of the given temperature unless it is in one, carrying its packed data along
   *  when it `keeps` it rather than packing afresh. */
  private settle(quad: MeshQuad, hot: boolean, keeps: boolean): void {
    const store = this.store;
    if (store === null || store.isHot(quad.slot) === hot) return;
    const slot = store.allocate(hot);
    if (keeps) store.move(quad.slot, slot);
    store.release(quad.slot);
    quad.slot = slot;
    quad.element._attributeStart = QuadStore.start(slot);
  }

  private pack(state: BandStills, quad: MeshQuad, textureId: number): void {
    const store = this.store;
    const renderer = this.renderer;
    if (store === null || renderer === null || this.packer === null) return;
    const pipe = renderer.renderPipes.sprite as unknown as SpritePipeInternals;
    const element = quad.element;
    pipe._updateBatchableSprite(quad.sprite, element);
    const start = QuadStore.start(quad.slot);
    element._batcher = state;
    element._textureId = textureId;
    element._attributeStart = start;
    this.packer.packQuadAttributes(element, store.f32, store.u32, start, textureId);
    quad.textureId = textureId;
    quad.containerTick = quad.sprite._didContainerChangeTick;
    quad.viewTick = quad.sprite._didViewChangeTick;
    quad.previousPackFrame = quad.packFrame;
    quad.packFrame = this.frame;
    store.markDirty(quad.slot);
  }

  /**
   * `member` draws through Pixi this rebuild. Its slots go now unless another band's draws still name
   * them; that band lost the child, so it rebuilds this frame and drops it then.
   */
  private reject(state: BandStills, member: Member): null {
    if (member.band === null || member.band === state) this.drop(member);
    return null;
  }

  private drop(member: Member): void {
    for (const quad of member.quads) this.free(quad);
    member.quads = [];
    member.band = null;
  }

  private free(quad: MeshQuad): void {
    if (!quad.live) return;
    quad.live = false;
    // A sprite re-matched to a new quad keeps its one batch record, which now names that quad.
    if (this.quads.get(quad.element) === quad) this.quads.delete(quad.element);
    this.store?.release(quad.slot);
  }
}
