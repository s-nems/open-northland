import { type BatchableSprite, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  installWorldBatcher,
  WORLD_ATTRIBUTE_OFFSETS,
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
