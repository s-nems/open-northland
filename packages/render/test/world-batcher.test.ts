import {
  type BatchableSprite,
  Container,
  type DefaultBatchableQuadElement,
  InstructionSet,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
  TextureSource,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  markPalettedTexture,
  markShadowTexture,
  setPixelArtMagnification,
  setWorldShadowStyle,
} from '../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE } from '../src/gpu/shadow-style.js';
import { SelectionSprite } from '../src/gpu/sprite-selection-effect.js';
import {
  installWorldBatcher,
  routeWorldBatches,
  WORLD_ATTRIBUTE_OFFSETS,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
  WORLD_VERTEX_SIZE,
  worldBatched,
} from '../src/gpu/world-batcher.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

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
    expect(WORLD_ATTRIBUTE_OFFSETS.aBlood + 4).toBe(stride);
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

  it('packs body blood on all four vertices and resets it for the next clean sprite', () => {
    const WorldBatcher = installWorldBatcher();
    const batcher = new WorldBatcher({ maxTextures: PAGES_AND_LUT });
    const sprite = new SelectionSprite(Texture.WHITE);
    const packed = 237 + 180 * 256 + 247 * 65536;
    sprite.bloodEffect = packed;
    const floats = new Float32Array(WORLD_VERTEX_SIZE * 4);
    const element = {
      texture: sprite.texture,
      renderable: sprite,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      color: 0xffffffff,
      roundPixels: 0,
    } as unknown as DefaultBatchableQuadElement;
    for (const value of [packed, 0]) {
      sprite.bloodEffect = value;
      batcher.packQuadAttributes(element, floats, new Uint32Array(floats.buffer), 0, 0);
      for (let i = 0; i < 4; i++)
        expect(floats[i * WORLD_VERTEX_SIZE + WORLD_ATTRIBUTE_OFFSETS.aBlood / 4]).toBe(value);
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
});

describe('world batcher palette LUT', () => {
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
      expect(flagsOf(0, vertex)).toBe(WORLD_FLAG_PALETTED | (3 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(1, vertex)).toBe(WORLD_FLAG_PALETTED | (1 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(2, vertex)).toBe(0);
    }

    // A repack outside a rebuild, such as a new frame on the same page, keeps the row.
    batcher.updateElement(elements[0] as DefaultBatchableQuadElement);
    expect(flagsOf(0, 0)).toBe(WORLD_FLAG_PALETTED | (3 << WORLD_LUT_ROW_SHIFT));
    batcher.destroy();
  });

  it('fills the page slots below the LUT with the LUT, so every bound slot names a texture', () => {
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
    const body = WORLD_FLAG_PALETTED | (2 << WORLD_LUT_ROW_SHIFT);
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
    setPixelArtMagnification('sharp');
    const sharp = batcher.shader;
    expect(sharp).not.toBe(plain);
    const style = { ...DEFAULT_SHADOW_STYLE };
    setWorldShadowStyle(style);
    const shaded = batcher.shader;
    expect(shaded).not.toBe(sharp);
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
    expect(batcher.shader).toBe(sharp);
    setPixelArtMagnification('off');
    expect(batcher.shader).toBe(plain);
    batcher.destroy();
    wider.destroy();
  });
});
