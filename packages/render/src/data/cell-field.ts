/**
 * The shared per-cell map-lane sampler core: one bilinear, edge-clamped lookup over a row-major
 * `width×height` grid. The elevation lift (`elevation.ts`) and the baked brightness shading
 * (`brightness.ts`) are thin wrappers over this — they must sample at identical coordinates or a
 * lifted sprite and its shading would disagree. No Pixi, no canvas — plain math, unit-tested
 * headlessly like the rest of `render`'s data layer.
 */

/** A bilinear sample of a per-cell lane at a continuous cell coordinate (raw lane units). */
export type CellSampler = (col: number, row: number) => number;

/**
 * Build the bilinear, edge-clamped sampler over a row-major per-cell lane. Fractional inputs (a
 * walking settler, a diamond corner between cell centres) interpolate; a sample past an edge repeats
 * the boundary cell (no wrap, no OOB). The sampler closes over the array by reference (never
 * mutated). Callers guarantee a non-empty lane and positive dims (their absent-lane paths return
 * shared flat/neutral fields instead).
 */
export function makeCellSampler(values: readonly number[], width: number, height: number): CellSampler {
  const at = (col: number, row: number): number => {
    const c = col < 0 ? 0 : col >= width ? width - 1 : col;
    const r = row < 0 ? 0 : row >= height ? height - 1 : row;
    return values[r * width + c] ?? 0;
  };
  return (col: number, row: number): number => {
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const tx = col - c0;
    const ty = row - r0;
    const e00 = at(c0, r0);
    const e10 = at(c0 + 1, r0);
    const e01 = at(c0, r0 + 1);
    const e11 = at(c0 + 1, r0 + 1);
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty;
  };
}
