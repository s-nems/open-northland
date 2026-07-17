/**
 * The shared per-cell map-lane sampler core: one bilinear, edge-clamped lookup over a row-major
 * `width×height` grid. The elevation lift (`elevation.ts`) and the baked brightness shading
 * (`brightness.ts`) are thin wrappers over this — they must sample at identical coordinates or a
 * lifted sprite and its shading would disagree. No Pixi, no canvas — plain math, unit-tested
 * headlessly like the rest of `render`'s data layer.
 */

import { lerp } from '../math.js';

/** A bilinear sample of a per-cell lane at a continuous cell coordinate (raw lane units). */
type CellSampler = (col: number, row: number) => number;

/**
 * The edge-clamped integer-cell lookup over a row-major lane — the shared nearest-cell core under
 * {@link makeCellSampler}'s bilinear taps and the whole-cell scans in `hillshade.ts`/`water.ts`
 * (out-of-range coordinates repeat the boundary cell, matching the GPU lane texture's clamp).
 */
export function clampedCellAt(
  values: ArrayLike<number>,
  width: number,
  height: number,
): (col: number, row: number) => number {
  return (col, row) => {
    const c = col < 0 ? 0 : col >= width ? width - 1 : col;
    const r = row < 0 ? 0 : row >= height ? height - 1 : row;
    return values[r * width + c] ?? 0;
  };
}

/**
 * Build the bilinear, edge-clamped sampler over a row-major per-cell lane. Fractional inputs (a
 * walking settler, a position between cell centres) interpolate; a sample past an edge repeats
 * the boundary cell (no wrap, no OOB). The sampler closes over the array by reference (never
 * mutated). Callers guarantee a non-empty lane and positive dims (their absent-lane paths return
 * shared flat/neutral fields instead).
 */
export function makeCellSampler(values: readonly number[], width: number, height: number): CellSampler {
  const at = clampedCellAt(values, width, height);
  return (col: number, row: number): number => {
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const tx = col - c0;
    const ty = row - r0;
    const e00 = at(c0, r0);
    const e10 = at(c0 + 1, r0);
    const e01 = at(c0, r0 + 1);
    const e11 = at(c0 + 1, r0 + 1);
    const top = lerp(e00, e10, tx);
    const bot = lerp(e01, e11, tx);
    return lerp(top, bot, ty);
  };
}
