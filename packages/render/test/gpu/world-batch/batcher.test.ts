import {
  Batch,
  type BatchableSprite,
  type Batcher,
  BatcherPipe,
  BatchTextureArray,
  Container,
  type DefaultBatchableMeshElement,
  type DefaultBatchableQuadElement,
  GlBatchAdaptor,
  type GlProgram,
  InstructionSet,
  Matrix,
  Rectangle,
  type Renderer,
  type Shader,
  Sprite,
  Texture,
  TextureSource,
  WebGLRenderer,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { bloodSurface } from '../../../src/gpu/blood/surface-sprite.js';
import {
  markIndexedSource,
  markMagnifiedTexture,
  markPalettedTexture,
  markPixelArtSource,
  markShadowTexture,
  palettedLutOf,
  setPixelArtMagnification,
  setPrescaledPage,
  setWorldShadowStyle,
  WORLD_MAGNIFY_MODES,
} from '../../../src/gpu/pixel-art/registry.js';
import { OutlineSprite, SelectionSprite } from '../../../src/gpu/selection/sprite-effect.js';
import { glProgramFor } from '../../../src/gpu/shaders/program-source.js';
import {
  bindWorldBatchPagesAndLut,
  installWorldBatcher,
  routeWorldBatches,
  WORLD_ATTRIBUTE_OFFSETS,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_INDEXED,
  WORLD_FLAG_MIPMAPPED,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_RECOLOURED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
  WORLD_VERTEX_SIZE,
  worldBatched,
} from '../../../src/gpu/world-batch/batcher.js';
import {
  WORLD_FLAG_MAGNIFY,
  type WorldBatchSampling,
  worldBatchProgramSource,
} from '../../../src/gpu/world-batch/shader.js';
import { DEFAULT_SHADOW_STYLE } from '../../../src/gpu/world-batch/shadow-style.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

/** One page slot plus the slot each batch keeps for a palette LUT. */
const PAGES_AND_LUT = 2;

describe('worldBatched', () => {
  it('renames a world sprite’s batchable record as it batches, every time Pixi mints a fresh one', () => {
    const batched: string[] = [];
    const pipe = {
      addToBatch(element: BatchableSprite, _instructions: InstructionSet): void {
        batched.push(element.batcherName);
      },
    };
    const renderer = { renderPipes: { batch: pipe } } as unknown as Renderer;
    routeWorldBatches(renderer);
    routeWorldBatches(renderer);
    const world = worldBatched(new Sprite());
    const hud = new Sprite();
    const record = (renderable: Sprite): BatchableSprite =>
      ({ batcherName: 'default', renderable }) as unknown as BatchableSprite;
    const instructions = new InstructionSet();
    pipe.addToBatch(record(world), instructions);
    pipe.addToBatch(record(hud), instructions);
    // Pixi's unload() mints a fresh record, named `default` again.
    pipe.addToBatch(record(world), instructions);
    expect(batched).toEqual(['world', 'default', 'world']);
    world.destroy();
    hud.destroy();
  });
});

describe('world batcher layout', () => {
  it('keeps the geometry stride and attribute offsets in step with the packed vertex size', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const stride = WORLD_VERTEX_SIZE * 4;
    for (const [name, offset] of Object.entries(WORLD_ATTRIBUTE_OFFSETS)) {
      const attribute = batcher.geometry.attributes[name];
      expect(attribute?.offset, name).toBe(offset);
      expect(attribute?.stride, name).toBe(stride);
    }
    expect(WORLD_ATTRIBUTE_OFFSETS.aNight + 4).toBe(stride);
    batcher.destroy();
  });
});

describe('world batcher element flags', () => {
  // The style is module-global and the worker shares modules across files.
  afterEach(() => setWorldShadowStyle(null));

  /** The flags float the packer wrote for one quad of `texture`. */
  function packedFlags(texture: Texture): number {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const floats = new Float32Array(WORLD_VERTEX_SIZE * 4);
    const element = {
      texture,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      color: 0xffffffff,
      roundPixels: 0,
    } as unknown as DefaultBatchableQuadElement;
    batcher.packQuadAttributes(element, floats, new Uint32Array(floats.buffer), 0, 0);
    batcher.destroy();
    return floats[WORLD_ATTRIBUTE_OFFSETS.aFlags / 4] ?? -1;
  }

  it('packs the frame as its own uv box, which bounds every magnify and minify tap', () => {
    const source = new TextureSource({ width: 8, height: 8 });
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const floats = new Float32Array(WORLD_VERTEX_SIZE * 4);
    const element = {
      texture: new Texture({ source, frame: new Rectangle(2, 4, 4, 2) }),
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      color: 0xffffffff,
      roundPixels: 0,
    } as unknown as DefaultBatchableQuadElement;
    batcher.packQuadAttributes(element, floats, new Uint32Array(floats.buffer), 0, 0);
    const at = WORLD_ATTRIBUTE_OFFSETS.aFrame / 4;
    expect(Array.from(floats.slice(at, at + 4))).toEqual([2 / 8, 4 / 8, 6 / 8, 6 / 8]);
    batcher.destroy();
    source.destroy();
  });

  it("packs an outline quad's body frame and reach, and clears the reach for the next plain sprite", () => {
    const source = new TextureSource({ width: 8, height: 8 });
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const floats = new Float32Array(WORLD_VERTEX_SIZE * 4);
    const outline = new OutlineSprite();
    outline.bodyTexture = new Texture({ source, frame: new Rectangle(2, 4, 4, 2) });
    // The grown view reaches past the body's frame onto its atlas neighbours.
    outline.texture = new Texture({ source, frame: new Rectangle(1, 3, 6, 4) });
    outline.setReach(0.25, 0, 0, 0.5);
    const element = (renderable: SelectionSprite) =>
      ({
        texture: renderable.texture,
        renderable,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        color: 0xffffffff,
        roundPixels: 0,
      }) as unknown as DefaultBatchableQuadElement;
    const frameAt = WORLD_ATTRIBUTE_OFFSETS.aFrame / 4;
    const splashAt = WORLD_ATTRIBUTE_OFFSETS.aSplashes / 4;
    batcher.packQuadAttributes(element(outline), floats, new Uint32Array(floats.buffer), 0, 0);
    for (let i = 0; i < 4; i++) {
      const vertex = i * WORLD_VERTEX_SIZE;
      expect(Array.from(floats.slice(vertex + frameAt, vertex + frameAt + 4))).toEqual([
        2 / 8,
        4 / 8,
        6 / 8,
        6 / 8,
      ]);
      expect(Array.from(floats.slice(vertex + splashAt, vertex + splashAt + 4))).toEqual([0.25, 0, 0, 0.5]);
    }
    batcher.packQuadAttributes(
      element(new SelectionSprite(Texture.WHITE)),
      floats,
      new Uint32Array(floats.buffer),
      0,
      0,
    );
    expect(Array.from(floats.slice(splashAt, splashAt + 4))).toEqual([0, 0, 0, 0]);
    batcher.destroy();
    source.destroy();
  });

  it('packs body blood on all four vertices and resets it for the next clean sprite', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const sprite = new SelectionSprite(Texture.WHITE);
    const packed = 237 + 180 * 256 + 247 * 65536;
    sprite.bloodEffect = packed;
    const surface = bloodSurface(sprite, 0);
    surface.packed.set([0xffffff, 0x050a22, 0x050a23, 0xffab01]);
    const floats = new Float32Array(WORLD_VERTEX_SIZE * 4);
    const element = {
      texture: sprite.texture,
      renderable: sprite,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      color: 0xffffffff,
      roundPixels: 0,
    } as unknown as DefaultBatchableQuadElement;
    for (const [value, enabled, facade, expectedBlood] of [
      [packed, true, false, packed],
      [0, true, true, -0.7],
      [0, false, true, 0],
    ] as const) {
      sprite.bloodEffect = value;
      bloodSurface(sprite, 0, { enabled, facade });
      batcher.packQuadAttributes(element, floats, new Uint32Array(floats.buffer), 0, 0);
      for (let i = 0; i < 4; i++) {
        expect(floats[i * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aBlood / 4]).toBeCloseTo(expectedBlood);
        const at = i * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aSplashes / 4;
        expect([...floats.slice(at, at + 4)]).toEqual(enabled ? [...surface.packed] : new Array(4).fill(0));
      }
    }
    sprite.destroy();
    batcher.destroy();
  });

  it('flags a shadow only under a style', () => {
    const page = new TextureSource({ width: 8, height: 8 });
    const blob = new Texture({ source: page });
    const body = new Texture({ source: page });
    markShadowTexture(blob);

    // No style compiled in: the shadow marks cannot reach the vertex stream.
    expect(packedFlags(blob)).toBe(0);

    setWorldShadowStyle(DEFAULT_SHADOW_STYLE);
    expect(packedFlags(blob)).toBe(WORLD_FLAG_SHADOW);
    expect(packedFlags(body)).toBe(0);

    for (const t of [blob, body]) t.destroy();
    page.destroy();
  });

  it('flags every texture cut from an indexed page, so its coverage reads from green', () => {
    const page = new TextureSource({ width: 8, height: 8 });
    markIndexedSource(page);
    const silhouette = new Texture({ source: page });
    markShadowTexture(silhouette);

    expect(packedFlags(silhouette)).toBe(WORLD_FLAG_INDEXED);
    setWorldShadowStyle(DEFAULT_SHADOW_STYLE);
    expect(packedFlags(silhouette)).toBe(WORLD_FLAG_INDEXED | WORLD_FLAG_SHADOW);

    silhouette.destroy();
    page.destroy();
  });

  it('flags a page with mipmaps, which mode off samples with gradients instead of level 0', () => {
    const page = new TextureSource({ width: 8, height: 8, autoGenerateMipmaps: true });
    const texture = new Texture({ source: page });

    expect(packedFlags(texture)).toBe(WORLD_FLAG_MIPMAPPED);
    const levels = new TextureSource({ width: 8, height: 8, mipLevelCount: 2 });
    const leveled = new Texture({ source: levels });
    expect(packedFlags(leveled)).toBe(WORLD_FLAG_MIPMAPPED);

    for (const t of [texture, leveled]) t.destroy();
    page.destroy();
    levels.destroy();
  });
});

describe('world batcher palette LUT', () => {
  useHeadlessShaderContext();
  /** A quad element as Pixi's sprite pipe hands it over, drawing `texture` through `lutRow`. */
  function quad(texture: Texture, lutRow?: number, glow = false) {
    return {
      batcherName: 'world',
      packAsQuad: true,
      attributeSize: 4,
      indexSize: 6,
      topology: 'triangle-list',
      blendMode: 'normal',
      texture,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      color: 0xffffffff,
      roundPixels: 0,
      renderable: lutRow === undefined ? {} : { lutRow, glow },
    } as unknown as DefaultBatchableQuadElement;
  }

  it('binds the LUT at the last slot and writes the row into each paletted vertex', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const lut = new TextureSource({ width: 256, height: 4 });
    const sheet = new TextureSource({ width: 8, height: 8 });
    const walker = new Texture({ source: sheet, frame: new Rectangle(0, 0, 4, 4) });
    const other = new Texture({ source: sheet, frame: new Rectangle(4, 0, 4, 4) });
    markPalettedTexture(walker, lut);
    markPalettedTexture(other, lut);
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });

    batcher.begin();
    const elements = [quad(walker, 3), quad(other, 1), quad(house)];
    for (const element of elements) batcher.add(element);
    batcher.break(new InstructionSet());

    // One page per batch leaves the reserved slot for the LUT: the house breaks into a batch of its own.
    const [characters, plain] = batcher.batches;
    expect(characters?.textures.count).toBe(2);
    expect(characters?.textures.textures[1]).toBe(lut);
    expect(plain?.textures.count).toBe(1);
    const floats = batcher.attributeBuffer.float32View;
    const flagsOf = (element: number, vertex: number) =>
      floats[(element * 4 + vertex) * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aFlags / 4];
    for (let vertex = 0; vertex < 4; vertex++) {
      expect(flagsOf(0, vertex)).toBe(WORLD_FLAG_PALETTED | WORLD_FLAG_INDEXED | (3 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(1, vertex)).toBe(WORLD_FLAG_PALETTED | WORLD_FLAG_INDEXED | (1 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(2, vertex)).toBe(0);
    }

    // A repack outside a rebuild, such as a new frame on the same page, keeps the row.
    batcher.updateElement(elements[0] as DefaultBatchableQuadElement);
    expect(flagsOf(0, 0)).toBe(WORLD_FLAG_PALETTED | WORLD_FLAG_INDEXED | (3 << WORLD_LUT_ROW_SHIFT));
    batcher.destroy();
  });

  it('packs a recoloured frame with the row its texture names', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const lut = new TextureSource({ width: 256, height: 4 });
    const sheet = new TextureSource({ width: 8, height: 8 });
    markPixelArtSource(sheet);
    const house = new Texture({ source: sheet, frame: new Rectangle(0, 0, 4, 4) });
    markPalettedTexture(house, lut, 2);
    // The texture cache marks a recoloured view magnified as it marks any pixel-art view.
    const tree = new Texture({ source: sheet, frame: new Rectangle(4, 0, 4, 4) });
    markPalettedTexture(tree, lut, 3);
    markMagnifiedTexture(tree);

    batcher.begin();
    batcher.add(quad(house));
    batcher.add(quad(tree));
    batcher.break(new InstructionSet());

    const floats = batcher.attributeBuffer.float32View;
    const flagsOf = (element: number) =>
      floats[element * 4 * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aFlags / 4];
    const recoloured = WORLD_FLAG_PALETTED | WORLD_FLAG_INDEXED | WORLD_FLAG_RECOLOURED;
    expect(flagsOf(0)).toBe(recoloured | (2 << WORLD_LUT_ROW_SHIFT));
    expect(flagsOf(1)).toBe(recoloured | WORLD_FLAG_MAGNIFY | (3 << WORLD_LUT_ROW_SHIFT));
    expect(batcher.batches[0]?.textures.textures[1]).toBe(lut);
    batcher.destroy();
  });

  it('fills the page slots below the LUT with the LUT, so the list has no holes', () => {
    const WorldBatcher = installWorldBatcher();
    // Three page slots plus the LUT's.
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 2 });
    const lut = new TextureSource({ width: 256, height: 4 });
    const walker = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(walker, lut);
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const barn = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const element = quad(house);

    batcher.begin();
    batcher.add(quad(walker, 1));
    batcher.add(element);
    batcher.break(new InstructionSet());

    const textures = batcher.batches[0]?.textures;
    expect(textures?.count).toBe(4);
    expect(textures?.textures.slice(0, textures.count)).toEqual([walker.source, house.source, lut, lut]);
    expect(textures?.ids[lut.uid]).toBe(3);
    // The third page takes the filled slot, not the LUT's.
    expect(batcher.checkAndUpdateTexture(element, barn)).toBe(true);
    expect([textures?.count, element._textureId, textures?.textures[2]]).toEqual([4, 2, barn.source]);
    batcher.destroy();
  });

  it('starts a batch for a paletted element whose LUT differs from its batch’s, in the same draw run', () => {
    const WorldBatcher = installWorldBatcher();
    // Three page slots plus the LUT's: every page fits one batch, so only the LUTs split it.
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 2 });
    const humans = new TextureSource({ width: 256, height: 4 });
    const vehicles = new TextureSource({ width: 256, height: 4 });
    const walker = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(walker, humans);
    const site = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(site, vehicles);
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const elements = [quad(walker, 1), quad(house), quad(site, 2), quad(house), quad(walker, 3)];

    batcher.begin();
    for (const element of elements) batcher.add(element);
    const instructions = new InstructionSet();
    batcher.break(instructions);

    const batches = batcher.batches.slice(0, batcher.batchIndex);
    expect(batches.map(({ textures }) => textures.textures.slice(0, textures.count))).toEqual([
      [walker.source, house.source, humans, humans],
      [site.source, house.source, vehicles, vehicles],
      [walker.source, humans, humans, humans],
    ]);
    expect(elements.map((element) => batches.indexOf(element._batch))).toEqual([0, 0, 1, 1, 2]);
    expect(batches.map(({ start, size }) => [start, size])).toEqual([
      [0, 12],
      [12, 12],
      [24, 6],
    ]);
    // Only the first batch binds the program and geometry, as when pages alone split a run.
    expect(batches.map(({ action }) => action)).toEqual(['startBatch', 'renderBatch', 'renderBatch']);
    expect(instructions.instructionSize).toBe(batches.length);
    batcher.destroy();
  });

  /** Pixi's own WebGL batch pipe and adaptor over a renderer that records texture binds and draws. */
  function recordingPipe() {
    const bound: [TextureSource, number][] = [];
    const drawn: number[] = [];
    /** The twin slot mask each upload carried, with the program current at the time. */
    const uploads: { slots: number; program: unknown }[] = [];
    /** The first two slots' page sizes each page size upload carried. */
    const pageSizes: number[][] = [];
    let program: unknown = null;
    const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
    Object.assign(renderer, {
      runners: { contextChange: { add: () => undefined } },
      state: { set: () => undefined },
      texture: {
        bind: (source: TextureSource, slot: number) => bound.push([source, slot]),
        unbindIntegerTextures: () => undefined,
      },
      geometry: { draw: (_topology: string, size: number) => drawn.push(size) },
      shader: {
        bind: (shader: { glProgram: unknown }) => {
          program = shader.glProgram;
        },
        updateUniformGroup: (group: { uniforms: { uTwinSlots?: number; uPageSizes?: Float32Array } }) => {
          const sizes = group.uniforms.uPageSizes;
          if (sizes !== undefined) pageSizes.push(Array.from(sizes.subarray(0, 4)));
          else uploads.push({ slots: group.uniforms.uTwinSlots ?? -1, program });
        },
      },
    });
    const pipe = new BatcherPipe(renderer, new GlBatchAdaptor());
    Object.assign(renderer, { renderPipes: { batch: pipe } });
    bindWorldBatchPagesAndLut(renderer);
    // A batch after the first of its batcher; the first also binds the shader and geometry.
    const draw = (batch: Batch) => {
      batch.action = 'renderBatch';
      renderer.renderPipes.batch.execute(batch);
    };
    return { bound, drawn, draw, uploads, pageSizes };
  }

  function builtBatch(
    maxTextures: number,
    textures: readonly Texture[],
  ): { batch: Batch; destroy: () => void } {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures });
    batcher.begin();
    for (const texture of textures)
      batcher.add(quad(texture, palettedLutOf(texture) === undefined ? undefined : 1));
    batcher.break(new InstructionSet());
    return { batch: batcher.batches[0] as Batch, destroy: () => batcher.destroy() };
  }

  it('binds only the pages and the LUT of a paletted batch, leaving the filled slots as they were', () => {
    const lut = new TextureSource({ width: 256, height: 4 });
    const walker = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(walker, lut);
    const { batch, destroy } = builtBatch(PAGES_AND_LUT + 2, [walker]);
    const { bound, drawn, draw } = recordingPipe();
    draw(batch);
    expect(bound).toEqual([
      [lut, 3],
      [walker.source, 0],
    ]);
    expect(drawn).toEqual([batch.size]);
    expect(batch.textures.count).toBe(4);
    destroy();
  });

  it('binds every listed slot of a plain world batch and of a batch from another batcher', () => {
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const barn = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const { batch, destroy } = builtBatch(PAGES_AND_LUT + 2, [house, barn]);
    const { bound, draw } = recordingPipe();
    draw(batch);
    expect(bound).toEqual([
      [house.source, 0],
      [barn.source, 1],
    ]);

    // Another batcher's repeat of its last page is an ordinary listed slot, bound like the rest.
    const other = new Batch();
    other.batcher = { name: 'default' } as Batcher;
    other.textures = new BatchTextureArray();
    for (const source of [house.source, barn.source, barn.source])
      other.textures.textures[other.textures.count++] = source;
    bound.length = 0;
    draw(other);
    expect(bound).toEqual([
      [house.source, 0],
      [barn.source, 1],
      [barn.source, 2],
    ]);
    destroy();
  });

  it("binds a page's prescaled twin in its slot for the draw, and lists the page again after it", () => {
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const barn = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const twin = new TextureSource({ width: 16, height: 16 });
    const { batch, destroy } = builtBatch(PAGES_AND_LUT + 2, [house, barn]);
    const { bound, draw } = recordingPipe();
    setPrescaledPage(barn.source, twin);
    try {
      draw(batch);
    } finally {
      setPrescaledPage(barn.source, null);
    }
    expect(bound).toEqual([
      [house.source, 0],
      [twin, 1],
    ]);
    expect(batch.textures.textures.slice(0, 2)).toEqual([house.source, barn.source]);
    destroy();
    twin.destroy();
  });

  it('swaps twins into a draw another batcher builds with the world program, as the still mesh does', () => {
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const twin = new TextureSource({ width: 16, height: 16 });
    const { batch, destroy } = builtBatch(PAGES_AND_LUT + 2, [house]);
    const still = new Batch();
    still.batcher = { name: 'stillMesh', shader: batch.batcher.shader } as unknown as Batcher;
    still.textures = new BatchTextureArray();
    still.textures.textures[still.textures.count++] = house.source;
    const other = new Batch();
    other.batcher = { name: 'default' } as Batcher;
    other.textures = new BatchTextureArray();
    other.textures.textures[other.textures.count++] = house.source;
    const { bound, draw } = recordingPipe();
    setPrescaledPage(house.source, twin);
    try {
      draw(still);
      draw(other);
    } finally {
      setPrescaledPage(house.source, null);
    }
    expect(bound).toEqual([
      [twin, 0],
      [house.source, 0],
    ]);
    expect(still.textures.textures[0]).toBe(house.source);
    destroy();
    twin.destroy();
  });

  it('hands the prescaled program a bit for each slot a twin stands in, with that program current', () => {
    const house = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const barn = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const twin = new TextureSource({ width: 16, height: 16 });
    const { batch, destroy } = builtBatch(PAGES_AND_LUT + 2, [house, barn]);
    // A still-mesh draw of the same program uploads its own slots, not the world batch's. Its shader is
    // the world batcher's current one, as the still mesh's is.
    const still = new Batch();
    still.batcher = {
      name: 'stillMesh',
      get shader() {
        return batch.batcher.shader;
      },
    } as unknown as Batcher;
    still.textures = new BatchTextureArray();
    still.textures.textures[still.textures.count++] = barn.source;
    const { draw, uploads, pageSizes } = recordingPipe();
    setPixelArtMagnification('xbrz');
    setPrescaledPage(barn.source, twin);
    try {
      draw(batch);
      draw(still);
      expect(uploads).toEqual([
        { slots: 0b10, program: batch.batcher.shader?.glProgram },
        { slots: 0b1, program: batch.batcher.shader?.glProgram },
      ]);
      // Each draw lists the sizes of the textures it binds, the twin's in the page's place.
      expect(pageSizes).toEqual([
        [8, 8, 16, 16],
        [16, 16, 16, 16],
      ]);
    } finally {
      setPrescaledPage(barn.source, null);
      setPixelArtMagnification('off');
    }
    destroy();
    twin.destroy();
  });

  it('flags a glowing paletted element beside its row', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const lut = new TextureSource({ width: 256, height: 4 });
    const walker = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(walker, lut);

    batcher.begin();
    batcher.add(quad(walker, 2, true));
    batcher.add(quad(walker, 2));
    batcher.break(new InstructionSet());

    const floats = batcher.attributeBuffer.float32View;
    const flagsOf = (element: number) =>
      floats[element * 4 * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aFlags / 4];
    const body = WORLD_FLAG_PALETTED | WORLD_FLAG_INDEXED | (2 << WORLD_LUT_ROW_SHIFT);
    expect(flagsOf(0)).toBe(body | WORLD_FLAG_GLOW);
    expect(flagsOf(1)).toBe(body);
    batcher.destroy();
  });

  it('lets a texture from a new page join its batch while a page slot is free', () => {
    const WorldBatcher = installWorldBatcher();
    // Two page slots plus the LUT's.
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 1 });
    const page = () => new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const [first, second, third] = [page(), page(), page()];
    const element = quad(first);
    batcher.begin();
    batcher.add(element);
    batcher.break(new InstructionSet());
    const textures = batcher.batches[0]?.textures;

    expect(batcher.checkAndUpdateTexture(element, second)).toBe(true);
    expect([textures?.count, element._textureId, textures?.textures[1]]).toEqual([2, 1, second.source]);
    // Both page slots are taken: a third page needs the rebuild.
    expect(batcher.checkAndUpdateTexture(element, third)).toBe(false);
    expect(element.texture).toBe(second);
    batcher.destroy();
  });

  /** A page left in place stays listed in its batch, which WebGL binds on every draw until a rebuild. */
  describe('a page an element left in place', () => {
    const page = () => new Texture({ source: new TextureSource({ width: 8, height: 8 }) });

    function leftBake() {
      const WorldBatcher = installWorldBatcher();
      const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 1 });
      const band = new Container({ isRenderGroup: true });
      const sprite = band.addChild(new Sprite());
      const [bake, next] = [page(), page()];
      const element = Object.assign(quad(bake), { renderable: sprite });
      batcher.begin();
      batcher.add(element);
      batcher.break(new InstructionSet());
      band.renderGroup.structureDidChange = false;
      return { batcher, band, bake, next, element };
    }

    it('rebuilds its render group when it is destroyed', () => {
      const { batcher, band, bake, next, element } = leftBake();
      expect(batcher.checkAndUpdateTexture(element, next)).toBe(true);
      expect(batcher.batches[0]?.textures.textures[0]).toBe(bake.source);
      bake.destroy(true);
      expect(band.renderGroup.structureDidChange).toBe(true);
      batcher.destroy();
    });

    it('rebuilds instead of swapping in place once it is already destroyed', () => {
      const { batcher, bake, next, element } = leftBake();
      bake.destroy(true);
      expect(batcher.checkAndUpdateTexture(element, next)).toBe(false);
      batcher.destroy();
    });

    it('is forgotten by the next build, which lists only the pages drawn', () => {
      const { batcher, band, bake, next, element } = leftBake();
      batcher.checkAndUpdateTexture(element, next);
      batcher.begin();
      bake.destroy(true);
      expect(band.renderGroup.structureDidChange).toBe(false);
      batcher.destroy();
    });
  });

  it('binds a joining paletted texture’s LUT into a batch without one, and refuses another LUT', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 1 });
    const plain = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const walker = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const lut = new TextureSource({ width: 256, height: 4 });
    markPalettedTexture(walker, lut);
    const beast = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(beast, new TextureSource({ width: 256, height: 4 }));
    const element = quad(plain);
    batcher.begin();
    batcher.add(element);
    batcher.break(new InstructionSet());

    expect(batcher.checkAndUpdateTexture(element, walker)).toBe(true);
    const textures = batcher.batches[0]?.textures;
    expect(textures?.textures.slice(0, textures.count)).toEqual([plain.source, walker.source, lut]);
    expect(batcher.checkAndUpdateTexture(element, beast)).toBe(false);
    expect(element.texture).toBe(walker);
    batcher.destroy();
  });
});

describe('world batcher shader selection', () => {
  useHeadlessShaderContext();
  afterEach(() => {
    setWorldShadowStyle(null);
    setPixelArtMagnification('off');
  });

  it('updates the compiled variant when live settings or the texture limit change', () => {
    setWorldShadowStyle(null);
    setPixelArtMagnification('off');
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const wider = new WorldBatcher({ maxTextures: PAGES_AND_LUT + 1 });
    const plain = batcher.shader;
    expect(batcher.shader).toBe(plain);
    setPixelArtMagnification('xbrz');
    const prescaled = batcher.shader;
    expect(prescaled).not.toBe(plain);
    const style = { ...DEFAULT_SHADOW_STYLE };
    setWorldShadowStyle(style);
    const shaded = batcher.shader;
    expect(shaded).not.toBe(prescaled);
    style.alphaGain += 0.25;
    const gain = batcher.shader;
    expect(gain).not.toBe(shaded);
    style.maxAlpha *= 0.5;
    const alpha = batcher.shader;
    expect(alpha).not.toBe(gain);
    style.tint = 0x123456;
    const tinted = batcher.shader;
    expect(tinted).not.toBe(alpha);
    expect(wider.shader).not.toBe(tinted);
    expect(batcher.shader).toBe(tinted);
    setWorldShadowStyle(null);
    expect(batcher.shader).toBe(prescaled);
    setPixelArtMagnification('off');
    expect(batcher.shader).toBe(plain);
    batcher.destroy();
    wider.destroy();
  });
  /** The program a world batch's run binds through Pixi's batch pipe, drawn under the render group
   *  transform `world` into a 64 x 32 px target: `world`'s scale is its screen pixels per unit. */
  function startProgram(batch: Batch, world: Matrix): GlProgram | null {
    let program: GlProgram | null = null;
    const width = 64;
    const height = 32;
    const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
    Object.assign(renderer, {
      runners: { contextChange: { add: () => undefined } },
      state: { set: () => undefined },
      texture: { bind: () => undefined, unbindIntegerTextures: () => undefined },
      geometry: { bind: () => undefined, draw: () => undefined },
      shader: {
        bind: (shader: Shader) => {
          program = shader.glProgram;
        },
        updateUniformGroup: () => undefined,
      },
      globalUniforms: {
        uniformGroup: {
          uniforms: {
            uProjectionMatrix: new Matrix(2 / width, 0, 0, -2 / height, -1, 1),
            uWorldTransformMatrix: world,
            uResolution: [width, height],
          },
        },
      },
    });
    const pipe = new BatcherPipe(renderer, new GlBatchAdaptor());
    Object.assign(renderer, { renderPipes: { batch: pipe } });
    bindWorldBatchPagesAndLut(renderer);
    batch.action = 'startBatch';
    pipe.execute(batch);
    return program;
  }

  /** A quad of `texture` drawn `scale` units per texel along both axes. */
  function scaledQuad(texture: Texture, scale: number, roundPixels = 0) {
    return {
      batcherName: 'world',
      packAsQuad: true,
      attributeSize: 4,
      indexSize: 6,
      topology: 'triangle-list',
      blendMode: 'normal',
      texture,
      transform: { a: scale, b: 0, c: 0, d: scale, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: texture.frame.width, maxY: texture.frame.height },
      color: 0xffffffff,
      roundPixels,
      renderable: {},
    } as unknown as DefaultBatchableQuadElement;
  }

  /** A two-triangle mesh of `texture` at its texel size. */
  function texelMesh(texture: Texture) {
    const { width, height } = texture.frame;
    return {
      batcherName: 'world',
      packAsQuad: false,
      attributeOffset: 0,
      attributeSize: 4,
      indexOffset: 0,
      indexSize: 6,
      topology: 'triangle-list',
      blendMode: 'normal',
      texture,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      color: 0xffffffff,
      roundPixels: 0,
      renderable: {},
    } as unknown as DefaultBatchableMeshElement;
  }

  const program = (sampling: WorldBatchSampling): GlProgram =>
    glProgramFor(worldBatchProgramSource(PAGES_AND_LUT, WORLD_MAGNIFY_MODES.xbr, null, sampling));

  it('draws through the unmagnified program while no gathering element is magnified', () => {
    setPixelArtMagnification('xbr');
    const page = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPixelArtSource(page.source);
    markMagnifiedTexture(page);
    const plain = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const build = (...elements: (DefaultBatchableQuadElement | DefaultBatchableMeshElement)[]): Batch => {
      batcher.begin();
      for (const element of elements) batcher.add(element);
      batcher.break(new InstructionSet());
      return batcher.batches[0] as Batch;
    };

    // One texel per pixel, or fewer, never magnifies; a zoom of two does.
    expect(startProgram(build(scaledQuad(page, 1)), new Matrix())).toBe(program('unmagnified'));
    expect(startProgram(build(scaledQuad(page, 1)), new Matrix(0.5, 0, 0, 0.5))).toBe(program('unmagnified'));
    expect(startProgram(build(scaledQuad(page, 1)), new Matrix(2, 0, 0, 2))).toBe(program('magnifying'));
    // Each next build follows an unmagnified draw, so only its own elements can pick magnifying.
    const afterUnmagnified = (element: DefaultBatchableQuadElement | DefaultBatchableMeshElement): Batch => {
      startProgram(build(scaledQuad(page, 1)), new Matrix());
      return build(element);
    };
    // Just under the 1:1 tolerance's margin magnifies.
    expect(startProgram(afterUnmagnified(scaledQuad(page, 1.005)), new Matrix())).toBe(program('magnifying'));
    // A snapped quad and a mesh may stretch their texels, so they draw magnifying.
    expect(startProgram(afterUnmagnified(scaledQuad(page, 1, 1)), new Matrix())).toBe(program('magnifying'));
    expect(startProgram(afterUnmagnified(texelMesh(page)), new Matrix())).toBe(program('magnifying'));
    // An element drawn at twice its texels magnifies; a page that never gathers does not count.
    expect(startProgram(build(scaledQuad(page, 1), scaledQuad(page, 2)), new Matrix())).toBe(
      program('magnifying'),
    );
    expect(startProgram(build(scaledQuad(page, 1), scaledQuad(plain, 4)), new Matrix())).toBe(
      program('unmagnified'),
    );
    // A rotated group is beyond the bound.
    const turn = Math.SQRT1_2;
    expect(startProgram(build(scaledQuad(page, 1)), new Matrix(turn, turn, -turn, turn))).toBe(
      program('magnifying'),
    );
    // A draw where nothing gathers keeps whichever program was bound last.
    expect(startProgram(build(scaledQuad(plain, 4)), new Matrix())).toBe(program('magnifying'));
    startProgram(build(scaledQuad(page, 1)), new Matrix());
    expect(startProgram(build(scaledQuad(plain, 4)), new Matrix())).toBe(program('unmagnified'));
    // A recoloured stem's unmagnified view (a badge) takes the plain path and never gathers either.
    const badge = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    markPalettedTexture(badge, new TextureSource({ width: 256, height: 4 }), 2);
    expect(startProgram(build(scaledQuad(page, 1), scaledQuad(badge, 4)), new Matrix())).toBe(
      program('unmagnified'),
    );
    batcher.destroy();
  });
});
