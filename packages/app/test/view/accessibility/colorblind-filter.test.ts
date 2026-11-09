import { describe, expect, it } from 'vitest';
import { correctionMatrix } from '../../../src/view/accessibility/colorblind-filter.js';
import type { ColorBlindFilter } from '../../../src/view/settings/store.js';

/** Apply a 20-value feColorMatrix to an sRGB colour, clamped to [0,1] like the display pipeline. */
function applyMatrix(values: number[], r: number, g: number, b: number): [number, number, number] {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const at = (i: number): number => values[i] ?? 0; // guard under noUncheckedIndexedAccess
  const x: [number, number, number, number] = [r, g, b, 1];
  const outR = at(0) * x[0] + at(1) * x[1] + at(2) * x[2] + at(3) * x[3] + at(4);
  const outG = at(5) * x[0] + at(6) * x[1] + at(7) * x[2] + at(8) * x[3] + at(9);
  const outB = at(10) * x[0] + at(11) * x[1] + at(12) * x[2] + at(13) * x[3] + at(14);
  return [clamp01(outR), clamp01(outG), clamp01(outB)];
}

/** A non-`off` filter always yields a matrix; fail loudly if the contract breaks. */
function matrix(filter: ColorBlindFilter): number[] {
  const m = correctionMatrix(filter);
  if (m === undefined) throw new Error(`expected a correction matrix for ${filter}`);
  return m;
}

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

describe('correctionMatrix (daltonization)', () => {
  it('returns undefined for the off filter', () => {
    expect(correctionMatrix('off')).toBeUndefined();
  });

  it('produces a 20-value feColorMatrix with a pass-through alpha row', () => {
    const m = matrix('deuteranopia');
    expect(m).toHaveLength(20);
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });

  it('is not the identity matrix (it actually recolours)', () => {
    const m = matrix('deuteranopia');
    expect(m).not.toEqual(IDENTITY);
    const differs = m.some((v, i) => Math.abs(v - (IDENTITY[i] ?? 0)) > 1e-6);
    expect(differs).toBe(true);
  });

  it('leaves a neutral grey unchanged', () => {
    for (const filter of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
      const [r, g, b] = applyMatrix(matrix(filter), 0.5, 0.5, 0.5);
      expect([r, g, b].every((c) => Math.abs(c - 0.5) < 1e-3)).toBe(true);
    }
  });

  it('separates red from green for red-green deficiency via the blue channel', () => {
    const m = matrix('deuteranopia');
    // Original red and green both have blue = 0, so a deutan confuses them.
    const red = applyMatrix(m, 1, 0, 0);
    const green = applyMatrix(m, 0, 1, 0);
    // After correction the two colours must differ in blue (or green).
    const blueGap = Math.abs(red[2] - green[2]);
    const greenGap = Math.abs(red[1] - green[1]);
    expect(Math.max(blueGap, greenGap)).toBeGreaterThan(0.05);
    // Pure red gains blue it did not have before, while green stays blue-less.
    expect(red[2]).toBeGreaterThan(0.05);
    expect(green[2]).toBe(0);
    // The correction adds to the source rather than replacing it with the simulated colour.
    expect(red[0]).toBe(1);
  });

  it('separates blue from yellow for tritanopia via the red/green channels', () => {
    const m = matrix('tritanopia');
    const blue = applyMatrix(m, 0, 0, 1);
    const yellow = applyMatrix(m, 1, 1, 0);
    const gap = Math.abs(blue[0] - yellow[0]) + Math.abs(blue[1] - yellow[1]) + Math.abs(blue[2] - yellow[2]);
    expect(gap).toBeGreaterThan(0.05);
    expect(m).not.toEqual(IDENTITY);
  });
});
