import {
  Batch,
  type BatchableElement,
  type BatchableSprite,
  Batcher,
  BatchTextureArray,
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
import { palettedLutOf, worldShadowStyle } from '../pixel-art-registry.js';
import {
  installWorldBatcher,
  isWorldBatched,
  WORLD_VERTEX_SIZE,
  worldBatchGeometry,
} from '../world-batcher.js';
import { type ByteUploader, QuadStore } from './quad-store.js';

/**
 * The still sprites of the depth-sorted layer, drawn from one retained mesh instead of Pixi's batches.
 *
 * A band rebuild walks its children in painter order as Pixi would. A child the owner calls still has its
 * sprites' quads in stable slots of a shared attribute buffer: the rebuild writes only their indices, and
 * each maximal run of still children between two others becomes one draw of the world batch program,
 * placed in the band's instructions where Pixi's own batches of that run would have been. A meshed
 * sprite's batch record names this mesh as its batcher, so Pixi's own update path (a transform, tint or
 * texture change between rebuilds) repacks its slot in place, and a page that does not fit asks Pixi for a
 * rebuild exactly as a full batch does.
 *
 * Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: a render group root collects
 * through `collectRenderablesSimple`; the sprite pipe's `_getGpuSprite` and `_updateBatchableSprite` mint
 * and refresh a sprite's batch record; updates reach the record's `_batcher.updateElement` and
 * `checkAndUpdateTexture` unless the group is rebuilding that frame; and the `batch` pipe draws any
 * `Batch` from its batcher's geometry and shader with its texture list bound.
 */

/** `globalDisplayStatus` of a container Pixi collects: visible, renderable and not culled. */
const DISPLAYED = 0b111;
const INDICES_PER_QUAD = 6;
const INITIAL_BAND_INDICES = 1024;
/**
 * Quad packs a run of still children must save per frame, on average, before it draws from the mesh: a
 * run costs two draws every frame (its own and the Pixi batch it splits), about what Pixi spends packing
 * two quads on a rebuild. A run qualifies when its quads times its band's rebuilds per frame reach this.
 * Measured in one session alternating the settings, magiczny_las t120000, x3, 4x CPU throttle: 2 beat 8
 * and 16 at zoom 0.35 (render 25.9 ms against 26.2 and 27.3) and stayed within noise of no mesh at zoom 1.
 */
const RUN_PAYOFF = 2;
/** Weight of the latest rebuild interval in a band's running estimate. */
const INTERVAL_WEIGHT = 0.25;
/** A band's estimated frames between rebuilds before it has rebuilt: it meshes nothing until its own
 *  rebuilds show it is worth it. */
const INITIAL_INTERVAL = 64;
/** A displayed child's place in a rebuild: drawn by Pixi, or a still candidate for the mesh. */
const PIXI = 0;
const STILL = 1;
const HIDDEN = 2;
/** The member record a still child carries, keyed off the container itself to spare a map lookup per
 *  child per rebuild. */
const MEMBER: unique symbol = Symbol('still mesh member');
type MemberHost = Container & { [MEMBER]?: Member };

/** Rebuilds a band's page table serves before a page that does not fit may start it anew: a band that
 *  truly draws more pages than a draw binds then repacks its quads once per this many rebuilds at most. */
const TABLE_MIN_BUILDS = 32;

interface SpritePipeInternals {
  _getGpuSprite(sprite: Sprite): BatchableSprite;
  _updateBatchableSprite(sprite: Sprite, element: BatchableSprite): void;
}

/** One sprite of a meshed child: its batch record and the slot its quad lives in. */
interface MeshQuad {
  readonly sprite: Sprite;
  readonly element: BatchableSprite;
  readonly slot: number;
  /** The sprite's change ticks when its quad was last packed. */
  containerTick: number;
  viewTick: number;
  textureId: number;
  live: boolean;
}

/** A still child of a band and the quads of its drawn sprites, in Pixi's collect order. */
interface Member {
  readonly container: Container;
  quads: MeshQuad[];
  /** The band whose last rebuild drew it from the mesh, and that rebuild's number. */
  band: BandStills | null;
  build: number;
  /** The container's change ticks and the shading its quads were packed under. */
  containerTick: number;
  viewTick: number;
  shading: boolean;
  /** The band table its quads' texture slots were taken from. */
  tableEpoch: number;
}

/** Whether Pixi would collect `c` at all: a hidden or culled child adds nothing to the instructions. */
function displayed(c: Container, layer: RenderLayer): boolean {
  return (
    (c.parentRenderLayer === null || c.parentRenderLayer === layer) &&
    c.globalDisplayStatus >= DISPLAYED &&
    c.includeInBuild
  );
}

/** A texture the world batch draws through its page alone, with the plain blend: what a slot carries. */
function meshableTexture(texture: Texture): boolean {
  const source: TextureSource | null = texture.source;
  return (
    source !== null &&
    !source.destroyed &&
    palettedLutOf(texture) === undefined &&
    getAdjustedBlendModeBlend('normal', source) === 'normal'
  );
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

/**
 * One band's share of the mesh: its geometry over the shared slots, its page table, and the draws its
 * last rebuild placed. The batcher is the record every meshed sprite of the band names, so Pixi's updates
 * reach the mesh; its geometry and shader are what the band's draws bind.
 */
class BandStills extends Batcher {
  override name = 'stillMesh';
  protected override vertexSize = WORLD_VERTEX_SIZE;
  override geometry: Geometry;
  declare shader: Shader;
  readonly table = new BatchTextureArray();
  /** The batch record of the band's meshed sprites, sharing {@link table} with its draws. */
  readonly slotBatch = new Batch();
  readonly bandIndices: Buffer;
  indices = new Uint32Array(INITIAL_BAND_INDICES);
  indexCount = 0;
  readonly draws: Batch[] = [];
  drawCount = 0;
  members: Member[] = [];
  spareMembers: Member[] = [];
  build = 0;
  /** A page in the table died, or one did not fit it: the next rebuild starts the table anew. */
  resetTable = false;
  /** The render this band last rebuilt on, and its running estimate of renders between rebuilds. */
  lastBuildFrame = -1;
  interval = INITIAL_INTERVAL;
  /** Per child of the running rebuild: {@link PIXI}, {@link STILL} or {@link HIDDEN}. */
  classes = new Uint8Array(0);
  /** Bumps whenever the table starts anew, which frees every slot a quad took from it. */
  tableEpoch = 0;
  private tableSince = 0;
  private readonly watched = new Set<TextureSource>();

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
    this.bandIndices = new Buffer({
      data: this.indices,
      label: 'still-mesh-indices',
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
    this.geometry = worldBatchGeometry(store.buffer, this.bandIndices);
    this.slotBatch.textures = this.table;
    Object.defineProperty(this, 'shader', { get: () => packer.shader });
  }

  /** The page's place in the band's table, joining it while a slot is free; null when the table is full. */
  pageSlot(source: TextureSource): number | null {
    const id: number | null | undefined = this.table.ids[source.uid];
    if (typeof id === 'number') return id;
    if (this.table.count >= this.maxTextures) {
      if (this.build - this.tableSince >= TABLE_MIN_BUILDS) this.resetTable = true;
      return null;
    }
    const slot = this.table.count++;
    this.table.ids[source.uid] = slot;
    this.table.textures[slot] = source;
    if (!this.watched.has(source)) {
      this.watched.add(source);
      source.once('destroy', this.pageDied, this);
    }
    return slot;
  }

  clearTable(): void {
    this.table.clear();
    for (const source of this.watched) source.off('destroy', this.pageDied, this);
    this.watched.clear();
    this.resetTable = false;
    this.tableEpoch++;
    this.tableSince = this.build;
  }

  /** A destroyed page must leave the table before the band draws again. */
  private pageDied(source: TextureSource): void {
    this.watched.delete(source);
    this.resetTable = true;
    this.band.renderGroup.structureDidChange = true;
  }

  reserveIndices(count: number): void {
    if (count <= this.indices.length) return;
    const grown = new Uint32Array(Math.max(count, this.indices.length * 2));
    grown.set(this.indices.subarray(0, this.indexCount));
    this.indices = grown;
  }

  override checkAndUpdateTexture(element: BatchableElement, texture: Texture): boolean {
    return this.mesh.retexture(this, element, texture);
  }

  override updateElement(element: BatchableElement): void {
    this.mesh.repack(element);
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
    this.clearTable();
    this.geometry.destroy(false);
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
  private readonly quads = new WeakMap<BatchableElement, MeshQuad>();
  /** Whether shadow shading is compiled in, which a shadow page's packed flags depend on. */
  private shading = worldShadowStyle() !== null;
  /** Renders so far, the clock of the bands' rebuild rates. */
  private frame = 0;
  private readonly upload: ByteUploader = (buffer, offset, size) => {
    buffer.update(size, offset);
    this.renderer?.buffer.updateBuffer(buffer);
  };

  /**
   * @param still whether the owner holds `child` still, so its sprites may draw from the mesh.
   * @param runPayoff the quad packs per frame a run must save to draw from the mesh ({@link RUN_PAYOFF}).
   */
  constructor(
    private readonly still: (child: Container) => boolean,
    private readonly runPayoff = RUN_PAYOFF,
  ) {}

  /** Meshed quads, for tests and tools. */
  get quadCount(): number {
    return this.store?.size ?? 0;
  }

  beforeRender(): void {
    this.frame++;
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
    if (state.resetTable) state.clearTable();
    const children = band.children as MemberHost[];
    this.classify(state, children, layer);
    state.indexCount = 0;
    state.drawCount = 0;
    const previous = state.members;
    state.members = state.spareMembers;
    state.members.length = 0;
    const classes = state.classes;
    let runStart = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const kind = classes[i];
      if (child === undefined || kind === HIDDEN) continue;
      const member = kind === STILL ? this.meshMember(state, child, layer) : null;
      if (member === null) {
        this.closeRun(state, instructionSet, renderer, runStart);
        runStart = state.indexCount;
        child.collectRenderables(instructionSet, renderer, layer);
        continue;
      }
      state.members.push(member);
      state.reserveIndices(state.indexCount + member.quads.length * INDICES_PER_QUAD);
      const indices = state.indices;
      let at = state.indexCount;
      for (const quad of member.quads) {
        const first = quad.slot * 4;
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
    for (const member of previous)
      if (member.band === state && member.build !== state.build) this.drop(member);
    previous.length = 0;
    state.spareMembers = previous;
    if (state.indexCount > 0) state.bandIndices.setDataWithSize(state.indices, state.indexCount, true);
    store.flush(this.upload);
    return true;
  }

  private forgetBand(band: Container): void {
    const state = this.bands.get(band);
    if (state === undefined) return;
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

  /** Pixi repacks a meshed sprite between rebuilds: write its slot and upload it. */
  repack(element: BatchableElement): void {
    const quad = this.quads.get(element);
    const store = this.store;
    if (quad === undefined || !quad.live || store === null || this.packer === null) return;
    this.packer.packQuadAttributes(
      quad.element,
      store.f32,
      store.u32,
      QuadStore.start(quad.slot),
      quad.textureId,
    );
    quad.containerTick = quad.sprite._didContainerChangeTick;
    quad.viewTick = quad.sprite._didViewChangeTick;
    store.markDirty(quad.slot);
    store.flush(this.upload);
  }

  /** Pixi asks whether a meshed sprite's new texture still draws from its band's mesh. */
  retexture(state: BandStills, element: BatchableElement, texture: Texture): boolean {
    const quad = this.quads.get(element);
    if (quad === undefined || !quad.live || !meshableTexture(texture)) return false;
    const id = state.pageSlot(texture.source);
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
   * Sort `children` into Pixi's and the mesh's for this rebuild: a still child joins the mesh only within
   * a run of still children whose quads, at the band's rebuild rate, pay for the run's draws.
   */
  private classify(state: BandStills, children: readonly MemberHost[], layer: RenderLayer): void {
    const elapsed = state.lastBuildFrame < 0 ? INITIAL_INTERVAL : this.frame - state.lastBuildFrame;
    state.lastBuildFrame = this.frame;
    state.interval += (elapsed - state.interval) * INTERVAL_WEIGHT;
    const minQuads = this.runPayoff * Math.max(1, state.interval);
    const n = children.length;
    if (state.classes.length < n) state.classes = new Uint8Array(Math.max(n, state.classes.length * 2));
    const classes = state.classes;
    for (let i = 0; i < n; i++) {
      const child = children[i];
      classes[i] =
        child === undefined || !displayed(child, layer) ? HIDDEN : this.still(child) ? STILL : PIXI;
    }
    // A hidden child adds nothing to the instructions, so it does not split a run.
    for (let i = 0; i < n; ) {
      if (classes[i] !== STILL) {
        i++;
        continue;
      }
      let end = i;
      let quads = 0;
      for (; end < n && classes[end] !== PIXI; end++)
        if (classes[end] === STILL) quads += children[end]?.children.length ?? 0;
      if (quads < minQuads) for (let k = i; k < end; k++) if (classes[k] === STILL) classes[k] = PIXI;
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
    let draw = state.draws[state.drawCount];
    if (draw === undefined) {
      draw = new Batch();
      draw.batcher = state;
      draw.textures = state.table;
      draw.blendMode = 'normal';
      draw.topology = 'triangle-list';
      state.draws.push(draw);
    }
    state.drawCount++;
    draw.action = 'startBatch';
    draw.start = start;
    draw.size = size;
    instructionSet.add(draw);
  }

  /**
   * `child` as a member of `state`'s mesh, its quads packed where anything they draw from changed; null
   * when a sprite of it cannot draw from the mesh or its page does not fit the band's table.
   */
  private meshMember(state: BandStills, child: MemberHost, layer: RenderLayer): Member | null {
    let member = child[MEMBER];
    if (member === undefined) {
      member = {
        container: child,
        quads: [],
        band: null,
        build: 0,
        containerTick: Number.NaN,
        viewTick: Number.NaN,
        shading: this.shading,
        tableEpoch: -1,
      };
      child[MEMBER] = member;
    }
    const reshaped =
      member.band === null ||
      member.containerTick !== child._didContainerChangeTick ||
      member.viewTick !== child._didViewChangeTick ||
      member.shading !== this.shading;
    if (reshaped && !this.reshape(member, layer)) return this.reject(state, member);
    // A member this band drew last rebuild, under the same table, keeps its slots' texture ids.
    const settled = !reshaped && member.band === state && member.tableEpoch === state.tableEpoch;
    for (const quad of member.quads) {
      const sprite = quad.sprite;
      // Pixi clears this as it collects a view, so the sprite's next change notifies the group again.
      if (sprite.didViewUpdate) sprite.didViewUpdate = false;
      const current =
        quad.containerTick === sprite._didContainerChangeTick && quad.viewTick === sprite._didViewChangeTick;
      if (settled && current) continue;
      const id = state.pageSlot(sprite.texture.source);
      if (id === null) return this.reject(state, member);
      if (!settled || !current || quad.textureId !== id) this.pack(state, quad, id);
    }
    member.band = state;
    member.build = state.build;
    member.tableEpoch = state.tableEpoch;
    member.containerTick = child._didContainerChangeTick;
    member.viewTick = child._didViewChangeTick;
    member.shading = this.shading;
    return member;
  }

  /** Match `member`'s quads to the sprites Pixi would collect of it now; false if one cannot be meshed. */
  private reshape(member: Member, layer: RenderLayer): boolean {
    if (!plainContainer(member.container)) return false;
    const sprites: Sprite[] = [];
    for (const sprite of member.container.children) {
      if (!displayed(sprite, layer)) continue;
      if (!meshableSprite(sprite)) return false;
      sprites.push(sprite);
    }
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
        textureId: -1,
        live: true,
      };
      this.quads.set(quad.element, quad);
      kept.push(quad);
    }
    for (const quad of member.quads) if (!kept.includes(quad)) this.free(quad);
    member.quads = kept;
    return true;
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
    element._batch = state.slotBatch;
    element._textureId = textureId;
    element._attributeStart = start;
    this.packer.packQuadAttributes(element, store.f32, store.u32, start, textureId);
    quad.textureId = textureId;
    quad.containerTick = quad.sprite._didContainerChangeTick;
    quad.viewTick = quad.sprite._didViewChangeTick;
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
    this.quads.delete(quad.element);
    this.store?.release(quad.slot);
  }
}
