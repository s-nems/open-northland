import { describe, expect, it } from 'vitest';
import { enhancePlayerColor } from '../../src/catalog/player-color.js';

/** Packed `0xRRGGBB` → `[r, g, b]` each in `0..255`. */
function channels(rgb: number): [number, number, number] {
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

/** Hue in degrees of a packed colour, for hue-preservation checks. */
function hue(rgb: number): number {
  const [r, g, b] = channels(rgb);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  const sector = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return (((sector * 60) % 360) + 360) % 360;
}

describe('enhancePlayerColor', () => {
  it('is byte-identical to the input at strength 1 (retail palette)', () => {
    for (const colour of [0x2f62d8, 0xd0342c, 0x9a9a9a, 0xe6862a, 0x000000, 0xffffff]) {
      expect(enhancePlayerColor(colour, 1)).toBe(colour);
    }
  });

  it('leaves an out-of-range strength as the retail colour (clamped to 1)', () => {
    expect(enhancePlayerColor(0x2f62d8, 0)).toBe(0x2f62d8);
    expect(enhancePlayerColor(0x2f62d8, -3)).toBe(0x2f62d8);
  });

  it('clamps an over-range strength to 10 without throwing', () => {
    expect(() => enhancePlayerColor(0x2f62d8, 99)).not.toThrow();
  });

  it('keeps the hue of a saturated colour (a red stays red)', () => {
    const source = 0xd0342c;
    const boosted = enhancePlayerColor(source, 10);
    // Hue is never touched, so the angle is unchanged and red stays the dominant channel.
    expect(hue(boosted)).toBeCloseTo(hue(source), 0);
    const [r, g, b] = channels(boosted);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('only raises saturation and value, never dims (boosted V ≥ original V)', () => {
    const original = channels(0x2f62d8);
    const boosted = channels(enhancePlayerColor(0x2f62d8, 10));
    const max = (c: [number, number, number]): number => Math.max(c[0], c[1], c[2]);
    expect(max(boosted)).toBeGreaterThanOrEqual(max(original));
  });

  it('is monotonic in strength: more strength never lowers the brightest channel', () => {
    const bright = (s: number): number => {
      const [r, g, b] = channels(enhancePlayerColor(0x2f9e33, s));
      return Math.max(r, g, b);
    };
    expect(bright(5)).toBeGreaterThanOrEqual(bright(1));
    expect(bright(10)).toBeGreaterThanOrEqual(bright(5));
  });

  it('does not change an achromatic grey into a coloured one', () => {
    const [r, g, b] = channels(enhancePlayerColor(0x9a9a9a, 10));
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });
});
