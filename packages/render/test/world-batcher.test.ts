import {
  type BatchableSprite,
  type DefaultBatchableQuadElement,
  InstructionSet,
  Rectangle,
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
import {
  installWorldBatcher,
  WORLD_ATTRIBUTE_OFFSETS,
  WORLD_FLAG_GLOW,
  WORLD_FLAG_PALETTED,
  WORLD_FLAG_SHADOW,
  WORLD_LUT_ROW_SHIFT,
  WORLD_LUT_SLOT_SHIFT,
  WORLD_VERTEX_SIZE,
  worldBatched,
} from '../src/gpu/world-batcher.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

/** One page slot plus the slot each batch keeps for a palette LUT. */
const PAGES_AND_LUT = 2;

describe('worldBatched', () => {
  it('renames every batchable record Pixi stores on the sprite, also after the map is replaced', () => {
    const sprite = worldBatched(new Sprite());
    const record = { batcherName: 'default', destroy() {} } as unknown as BatchableSprite;
    sprite._gpuData[1] = record;
    expect(record.batcherName).toBe('world');
    // Pixi's unload() swaps in a fresh map; records landing there must still be renamed.
    sprite._gpuData = Object.create(null);
    const later = { batcherName: 'default', destroy() {} } as unknown as BatchableSprite;
    sprite._gpuData[2] = later;
    expect(later.batcherName).toBe('world');
    expect(sprite._gpuData[1]).toBeUndefined();
    // Pixi's GC hash clears a slot with null; the rename must not touch it.
    sprite._gpuData[2] = null as unknown as BatchableSprite;
    expect(sprite._gpuData[2]).toBeNull();
    sprite.destroy();
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
    expect(WORLD_ATTRIBUTE_OFFSETS.aFrame + 4 * 4).toBe(stride);
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

  it('binds the LUT after the batch pages and writes its slot and row into each paletted vertex', () => {
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
    const slotOne = WORLD_FLAG_PALETTED | (1 << WORLD_LUT_SLOT_SHIFT);
    for (let vertex = 0; vertex < 4; vertex++) {
      expect(flagsOf(0, vertex)).toBe(slotOne | (3 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(1, vertex)).toBe(slotOne | (1 << WORLD_LUT_ROW_SHIFT));
      expect(flagsOf(2, vertex)).toBe(0);
    }

    // A repack outside a rebuild, such as a new frame on the same page, keeps the slot.
    batcher.updateElement(elements[0] as DefaultBatchableQuadElement);
    expect(flagsOf(0, 0)).toBe(slotOne | (3 << WORLD_LUT_ROW_SHIFT));
    batcher.destroy();
  });

  it('flags a glowing paletted element beside its slot and row', () => {
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
    const body = WORLD_FLAG_PALETTED | (1 << WORLD_LUT_SLOT_SHIFT) | (2 << WORLD_LUT_ROW_SHIFT);
    expect(flagsOf(0)).toBe(body | WORLD_FLAG_GLOW);
    expect(flagsOf(1)).toBe(body);
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
