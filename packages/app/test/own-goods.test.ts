import { describe, expect, it } from 'vitest';
import { ownGoodAtlas, ownGoodBindings, ownGoodManifest } from '../src/content/own-assets/good-manifest.js';

const manifest = {
  id: 'wood',
  image: 'atlas.png',
  width: 60,
  height: 10,
  scale: 0.5,
  frames: Array.from({ length: 6 }, (_, i) => ({
    x: i * 10,
    y: 0,
    width: 10,
    height: 10,
    anchor: { x: 5, y: 8 },
  })),
  sourceBasis: 'Synthetic fixture',
};
describe('own goods', () => {
  it('requires all five quantities and the icon inside the atlas', () => {
    expect(ownGoodManifest.safeParse(manifest).success).toBe(true);
    expect(ownGoodManifest.safeParse({ ...manifest, frames: manifest.frames.slice(1) }).success).toBe(false);
    expect(ownGoodManifest.safeParse({ ...manifest, width: 59 }).success).toBe(false);
    expect(
      ownGoodManifest.safeParse({
        ...manifest,
        frames: manifest.frames.map((f) => ({ ...f, anchor: { x: 11, y: 8 } })),
      }).success,
    ).toBe(false);
  });
  it('joins by slug in either content number space and leaves unknown goods and the flag alone', () => {
    const fallback = { default: 7, flag: [9] as const, byGood: { 2: [8] } };
    for (const typeId of [5, 37]) {
      const binding = ownGoodBindings(fallback, [{ id: 'wood', typeId }], [manifest]);
      expect(binding.byGood[typeId]).toEqual(
        Array.from({ length: 5 }, (_, bob) => ({ layer: 'own-good-wood', bob })),
      );
      expect(binding.byGood[2]).toEqual([8]);
      expect(binding.flag).toEqual([9]);
      expect(binding.default).toBe(7);
    }
    expect(ownGoodBindings(fallback, [], [manifest])).toEqual(fallback);
    expect(() => ownGoodBindings(fallback, [], [manifest, manifest])).toThrow('Duplicate');
  });
  it('retains frame-specific ground anchors and a separate UI frame', () => {
    const atlas = ownGoodAtlas(manifest);
    expect(atlas.frames.get(4)).toEqual({ x: 40, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -8 });
    expect(atlas.frames.get(5)?.x).toBe(50);
  });
});
