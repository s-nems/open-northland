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
  GlProgram,
  getBatchSamplersUniformGroup,
  type InstructionSet,
  type Renderer,
  type RenderGroup,
  Shader,
  type Texture,
  type TextureSource,
  type ViewContainer,
} from 'pixi.js';
import {
  isMagnifiedTexture,
  isShadowTexture,
  palettedLutOf,
  pixelArtMagnifyMode,
  worldShadowStyle,
} from './pixel-art-registry.js';
import type { ShadowStyle } from './shadow-style.js';
import { spriteSelectionEffect } from './sprite-selection-effect.js';
import { WorldAttributeBuffer } from './world-attribute-buffer.js';
import {
  LUT_SLOTS,
  lutSlotOf,
  WORLD_BATCH_MAX_TEXTURES,
  WORLD_BATCH_VERTEX,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_MAGNIFY,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
  worldBatchFragment,
} from './world-batch-shader.js';

export {
  GLOW_PALETTE_INDEX,
  lutSlotOf,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
} from './world-batch-shader.js';

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

/** Vertex layout: Pixi's six (x, y, u, v, colour, textureIdAndRound) + element flags + frame UV box. */
export const WORLD_VERTEX_SIZE = 12;
const STRIDE = WORLD_VERTEX_SIZE * 4;
export const WORLD_ATTRIBUTE_OFFSETS = {
  aPosition: 0,
  aUV: 2 * 4,
  aColor: 4 * 4,
  aTextureIdAndRound: 5 * 4,
  aFlags: 6 * 4,
  aFrame: 7 * 4,
  aSelection: 11 * 4,
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

function lutRowOf(element: BatchableElement): number {
  const renderable = renderableOf(element);
  if (renderable === null || !('lutRow' in renderable)) return 0;
  return typeof renderable.lutRow === 'number' ? renderable.lutRow : 0;
}

function glowOf(element: BatchableElement): boolean {
  const renderable = renderableOf(element);
  return renderable !== null && 'glow' in renderable && renderable.glow === true;
}

/** The batcher class, its geometry and shaders are defined on first install, not at import, so a
 *  test that mocks `pixi.js` can still load this module. */
type WorldBatcherClass = new (options: BatcherOptions) => Batcher;
let worldBatcherClass: WorldBatcherClass | undefined;

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
    },
    indexBuffer,
  });
}

function defineWorldBatcher(): WorldBatcherClass {
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
  // so the map holds at most two programs per magnification mode.
  const shaders = new Map<string, Shader>();
  let lastShader:
    | {
        readonly maxTextures: number;
        readonly mode: number;
        readonly alphaGain: number | undefined;
        readonly maxAlpha: number | undefined;
        readonly tint: number | undefined;
        readonly shader: Shader;
      }
    | undefined;

  function shadowKey(shadow: ShadowStyle | null): string {
    return shadow === null ? 'off' : `${shadow.alphaGain}/${shadow.maxAlpha}/${shadow.tint.toString(16)}`;
  }

  function shaderFor(maxTextures: number, mode: number, shadow: ShadowStyle | null): Shader {
    // Most batches use the same variant; avoid formatting its cache key on every bind.
    if (
      lastShader !== undefined &&
      lastShader.maxTextures === maxTextures &&
      lastShader.mode === mode &&
      lastShader.alphaGain === shadow?.alphaGain &&
      lastShader.maxAlpha === shadow?.maxAlpha &&
      lastShader.tint === shadow?.tint
    )
      return lastShader.shader;
    const shading = shadowKey(shadow);
    const key = `${maxTextures}:${mode}:${shading}`;
    let shader = shaders.get(key);
    if (shader === undefined) {
      shader = new Shader({
        glProgram: new GlProgram({
          name: `world-batch-${mode}-${shading}`,
          vertex: WORLD_BATCH_VERTEX,
          fragment: worldBatchFragment(maxTextures, mode, shadow),
        }),
        resources: { batchSamplers: getBatchSamplersUniformGroup(maxTextures) },
      });
      shaders.set(key, shader);
    }
    lastShader = {
      maxTextures,
      mode,
      alphaGain: shadow?.alphaGain,
      maxAlpha: shadow?.maxAlpha,
      tint: shadow?.tint,
      shader,
    };
    return shader;
  }

  /** The element being packed: what each of its vertices repeats, including its frame's UV box. Filled
   *  by {@link beginElement} so the packers allocate nothing per element. */
  const packing = {
    selection: 0,
    textureIdAndRound: 0,
    argb: 0,
    flags: 0,
    minU: 0,
    minV: 0,
    maxU: 0,
    maxV: 0,
  };

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
    return index + WORLD_VERTEX_SIZE - 2;
  }

  /** The flags of an element whose page is not paletted; the shadow lookups are skipped entirely while
   *  no shadow shading is compiled in. */
  function plainFlags(texture: Texture): number {
    const magnify = isMagnifiedTexture(texture) ? WORLD_FLAG_MAGNIFY : 0;
    if (worldShadowStyle() === null || !isShadowTexture(texture)) return magnify;
    return magnify | WORLD_FLAG_SHADOW;
  }

  function palettedFlags(element: BatchableElement): number {
    return (
      WORLD_FLAG_PALETTED |
      (glowOf(element) ? WORLD_FLAG_GLOW : 0) |
      (lutRowOf(element) << WORLD_LUT_ROW_SHIFT)
    );
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
    /** Pages elements left since the last build, which their batches may still list. */
    private readonly leftPages = new Set<TextureSource>();
    /** The render group whose instructions this batcher builds; Pixi keeps one batcher per group. */
    private renderGroup: RenderGroup | null = null;

    override updateElement(element: BatchableElement): void {
      const buffer = this.geometry.buffers[0];
      if (buffer instanceof WorldAttributeBuffer)
        buffer.changed(
          element._attributeStart * Float32Array.BYTES_PER_ELEMENT,
          element.attributeSize * this.vertexSize * Float32Array.BYTES_PER_ELEMENT,
        );
      super.updateElement(element);
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

    /** Pages the batch lists: every slot below the LUT, which also fills the gap up to its own slot so
     *  Pixi binds a texture at each. */
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
      super.begin();
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

    override break(instructionSet: InstructionSet): void {
      this.breaking = true;
      try {
        super.break(instructionSet);
      } finally {
        this.breaking = false;
      }
      for (const element of this.paletted) {
        const lut = palettedLutOf(element.texture);
        if (lut !== undefined && !this.bindLut(element._batch, lut)) {
          throw new Error('A world batch holds one palette LUT');
        }
      }
      this.paletted.length = 0;
    }

    /** Lists `lut` at the batch's LUT slot, filling the page slots up to it with the LUT as well so Pixi
     *  binds every listed slot; false when the batch already holds another LUT. */
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
      packing.selection = spriteSelectionEffect(renderableOf(element));
      beginElement(element.texture, textureIdAndRound, element.color, this.flagsOf(element));
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
      packing.selection = spriteSelectionEffect(renderableOf(element));
      beginElement(texture, textureIdAndRound, element.color, this.flagsOf(element));
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
      return shaderFor(this.maxTextures + LUT_SLOTS, pixelArtMagnifyMode(), worldShadowStyle());
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
