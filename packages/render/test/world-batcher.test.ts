import {
  type BatchableSprite,
  type DefaultBatchableQuadElement,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { markShadowTexture, setWorldShadowStyle } from '../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE } from '../src/gpu/shadow-style.js';
import {
  installWorldBatcher,
  WORLD_ATTRIBUTE_OFFSETS,
  WORLD_FLAG_SHADOW,
  WORLD_FLAG_STRAIGHT_ALPHA,
  WORLD_VERTEX_SIZE,
  worldBatched,
} from '../src/gpu/world-batcher.js';

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
    const batcher = new WorldBatcher({ maxTextures: 1 });
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
    const batcher = new WorldBatcher({ maxTextures: 1 });
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
    const batcher = new WorldBatcher({ maxTextures: 1 });
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

  it('flags a shadow only under a style, and marks a straight-alpha page for its own blend', () => {
    const premultiplied = new TextureSource({ width: 8, height: 8 });
    const straight = new TextureSource({ width: 8, height: 8 });
    straight.alphaMode = 'no-premultiply-alpha'; // the indexed character sheets load this way
    const blob = new Texture({ source: premultiplied });
    const cast = new Texture({ source: straight });
    const body = new Texture({ source: premultiplied });
    markShadowTexture(blob);
    markShadowTexture(cast);

    // No style compiled in: the shadow marks cannot reach the vertex stream.
    expect(packedFlags(blob)).toBe(0);

    setWorldShadowStyle(DEFAULT_SHADOW_STYLE);
    expect(packedFlags(blob)).toBe(WORLD_FLAG_SHADOW);
    expect(packedFlags(cast)).toBe(WORLD_FLAG_SHADOW | WORLD_FLAG_STRAIGHT_ALPHA);
    expect(packedFlags(body)).toBe(0);

    for (const t of [blob, cast, body]) t.destroy();
    premultiplied.destroy();
    straight.destroy();
  });
});
