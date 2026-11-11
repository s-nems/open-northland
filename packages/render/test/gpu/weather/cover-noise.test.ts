import { describe, expect, it } from 'vitest';
import {
  COVER_NOISE_PERIOD,
  coverLatticeValue,
  coverNoiseLattice,
} from '../../../src/gpu/weather/cover-noise.js';

const PERIOD = COVER_NOISE_PERIOD;
const CORNERS = 4;

describe('cover noise lattice', () => {
  const lattice = coverNoiseLattice();
  const texel = (x: number, y: number): number[] =>
    Array.from(lattice.subarray((y * PERIOD + x) * CORNERS, (y * PERIOD + x + 1) * CORNERS));
  const cell = (x: number, y: number): number => Math.fround(coverLatticeValue(x, y));

  it('stores each cell with its right, lower and diagonal neighbours', () => {
    expect(texel(3, 7)).toEqual([cell(3, 7), cell(4, 7), cell(3, 8), cell(4, 8)]);
  });

  it('wraps the neighbours of the last row and column onto the first, so the tile has no seam', () => {
    const last = PERIOD - 1;
    expect(texel(last, last)).toEqual([cell(last, last), cell(0, last), cell(last, 0), cell(0, 0)]);
    expect(coverLatticeValue(PERIOD + 5, -1)).toBe(coverLatticeValue(5, last));
  });

  it('holds 24-bit fractions a float32 keeps exactly', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [17, 200],
    ] as const) {
      const value = coverLatticeValue(x, y);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Math.fround(value)).toBe(value);
    }
  });
});
