import { describe, expect, it } from 'vitest';
import { buildPaletteLutImage } from '../src/decoders/image.js';
import { solidPalette } from './fixtures/palette.js';

/**
 * Shared image-currency tests. No copyrighted fixtures: synthetic 768-byte RGB palettes with distinct,
 * easy-to-assert values.
 */
describe('buildPaletteLutImage', () => {
  it('stacks palettes into a 256×N RGBA image, one row per palette, alpha 255', () => {
    const a = solidPalette(1, 2, 3);
    const b = solidPalette(4, 5, 6);
    const img = buildPaletteLutImage([a, b]);
    expect(img.width).toBe(256);
    expect(img.height).toBe(2);
    // Row 0 = palette a, row 1 = palette b; alpha always opaque.
    const px = (x: number, y: number): number[] => {
      const o = (y * 256 + x) * 4;
      return Array.from(img.rgba.slice(o, o + 4));
    };
    expect(px(0, 0)).toEqual([1, 2, 3, 255]);
    expect(px(255, 0)).toEqual([1, 2, 3, 255]);
    expect(px(128, 1)).toEqual([4, 5, 6, 255]);
  });

  it('throws on an empty list or a wrong-sized palette', () => {
    expect(() => buildPaletteLutImage([])).toThrow(/at least one/);
    expect(() => buildPaletteLutImage([new Uint8Array(100)])).toThrow(/768 bytes/);
  });
});
