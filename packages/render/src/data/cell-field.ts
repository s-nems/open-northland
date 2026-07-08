/**
 * The shared per-cell map-lane sampler core: one bilinear, edge-clamped lookup over a row-major
 * `width×height` grid, plus the CANONICAL diamond-corner coordinates that keep every corner sample
 * watertight across the staggered raster. The elevation lift (`elevation.ts`) and the baked
 * brightness shading (`brightness.ts`) are thin wrappers over this — they must sample at identical
 * coordinates or the ground mesh's lifted geometry and its shading would disagree at shared vertices.
 * No Pixi, no canvas — plain math, unit-tested headlessly like the rest of `render`'s data layer.
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

/**
 * The four diamond-corner samples `[top, right, bottom, left]` of a per-cell lane for terrain cell
 * `(col, row)`, for baking into the ground mesh. Each corner sits BETWEEN cell centres and is SHARED
 * by up to four diamonds; the sample must be identical from every sharing cell or the mesh cracks
 * (in geometry for the lift, in shading for the brightness). It is, because each corner is sampled
 * at a CANONICAL continuous cell coordinate that is a pure function of the corner's position in the
 * staggered raster, not of which cell references it:
 *
 *   a vertex at raster lattice `(X, Y)` (cell centres have `X = 2·col + (row&1)`, `Y = row`) maps to
 *   `(col, row) = ((X − (Y&1))/2, Y)` — so a shared corner resolves to the SAME `(col, row)` (hence
 *   the same bilinear sample) from either owner. Worked per corner of `(col, row)` with `s = row&1`:
 *     top    → sample at (col+s−0.5, row−1)   bottom → (col+s−0.5, row+1)
 *     right  → (col+0.5, row)                 left   → (col−0.5, row)
 *
 * At an integer row the bilinear degenerates to a linear blend of the two cells straddling the
 * corner — a smooth, watertight field. Pure.
 */
export function diamondCornerSamples(
  sample: CellSampler,
  col: number,
  row: number,
): [number, number, number, number] {
  const [t, r, b, l] = diamondCornerCoords(col, row);
  return [sample(t[0], t[1]), sample(r[0], r[1]), sample(b[0], b[1]), sample(l[0], l[1])];
}

/** One canonical continuous cell coordinate `[col, row]`. */
export type CellCoord = readonly [number, number];

/**
 * The CANONICAL continuous cell coordinates of terrain cell `(col, row)`'s four diamond corners
 * `[top, right, bottom, left]` — the coordinates {@link diamondCornerSamples} samples at, exposed so
 * a consumer that needs the COORDINATE rather than a sampled value (the shaded ground's per-fragment
 * lane UVs) shares the same watertight mapping. Note the canonical row coordinate is exactly
 * `screen_y / rowStep` at every corner, so a per-fragment interpolation of these coordinates varies
 * LINEARLY with screen y — a row-graded lane (the map-border fade) shades in smooth horizontal
 * bands, like the original, not along triangle edges.
 */
export function diamondCornerCoords(col: number, row: number): [CellCoord, CellCoord, CellCoord, CellCoord] {
  const s = row & 1;
  return [
    [col + s - 0.5, row - 1], // top
    [col + 0.5, row], // right
    [col + s - 0.5, row + 1], // bottom
    [col - 0.5, row], // left
  ];
}
