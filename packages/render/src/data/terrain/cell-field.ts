/**
 * The shared per-cell map-lane sampler core. The elevation lift and the baked brightness shading must
 * sample at identical coordinates, or a lifted sprite and its shading disagree.
 */

import { lerp } from '../math.js';

/** Raw lane units. */
type CellSampler = (col: number, row: number) => number;

/** An out-of-range coordinate repeats the boundary cell, matching the GPU lane texture's clamp. */
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
 * Build the bilinear sampler over a row-major per-cell lane. Closes over the array by reference, never
 * mutating it. Callers must pass a non-empty lane and positive dimensions.
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
