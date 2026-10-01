import { clamp } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';

/** Per-cell lane helpers over the staggered raster, shared by the minimap's cell passes. */

/** A per-cell lane, or `undefined` when absent or not one value per cell. */
export function laneOf(lane: ArrayLike<number> | undefined, cells: number): ArrayLike<number> | undefined {
  return lane !== undefined && lane.length === cells ? lane : undefined;
}

/** Separable box blur over the cell grid with running sums; rows take the pitch ratio so the kernel is
 *  roughly round. Edges repeat the boundary cell. */
export function boxBlur(
  values: ArrayLike<number>,
  width: number,
  height: number,
  radiusCols: number,
): Float32Array {
  const radiusRows = Math.round((radiusCols * 2 * TILE_HALF_W) / TILE_HALF_H);
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const lastCol = width - 1;
  const lastRow = height - 1;
  const colNorm = 1 / (2 * radiusCols + 1);
  const rowNorm = 1 / (2 * radiusRows + 1);
  for (let row = 0; row < height; row++) {
    const base = row * width;
    let sum = 0;
    for (let d = -radiusCols; d <= radiusCols; d++) sum += values[base + clamp(d, 0, lastCol)] ?? 0;
    for (let col = 0; col < width; col++) {
      tmp[base + col] = sum * colNorm;
      const enter = col + radiusCols + 1;
      const leave = col - radiusCols;
      sum +=
        (values[base + (enter > lastCol ? lastCol : enter)] ?? 0) -
        (values[base + (leave < 0 ? 0 : leave)] ?? 0);
    }
  }
  for (let col = 0; col < width; col++) {
    let sum = 0;
    for (let d = -radiusRows; d <= radiusRows; d++) sum += tmp[clamp(d, 0, lastRow) * width + col] ?? 0;
    for (let row = 0; row < height; row++) {
      out[row * width + col] = sum * rowNorm;
      const enter = row + radiusRows + 1;
      const leave = row - radiusRows;
      sum +=
        (tmp[(enter > lastRow ? lastRow : enter) * width + col] ?? 0) -
        (tmp[(leave < 0 ? 0 : leave) * width + col] ?? 0);
    }
  }
  return out;
}

/** The centre's weight in {@link staggerBlur}, against one per touching cell. */
const BLUR_CENTRE_WEIGHT = 2;

/**
 * One blur pass over each cell and its six touching cells (centre weighted double), reading every
 * `stride`-th value from `offset`. Returns one value per cell.
 */
export function staggerBlur(
  values: ArrayLike<number>,
  width: number,
  height: number,
  stride = 1,
  offset = 0,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    // The touching cells of the rows above and below sit at columns `col + shift` and `col + shift + 1`.
    const shift = -1 + (row & 1);
    const hasUp = row > 0;
    const hasDown = row < height - 1;
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      let sum = BLUR_CENTRE_WEIGHT * (values[cell * stride + offset] ?? 0);
      let weight = BLUR_CENTRE_WEIGHT;
      if (col > 0) {
        sum += values[(cell - 1) * stride + offset] ?? 0;
        weight++;
      }
      if (col < width - 1) {
        sum += values[(cell + 1) * stride + offset] ?? 0;
        weight++;
      }
      const left = col + shift;
      const leftIn = left >= 0;
      const rightIn = left + 1 < width;
      if (hasUp) {
        const up = cell - width + shift;
        if (leftIn) {
          sum += values[up * stride + offset] ?? 0;
          weight++;
        }
        if (rightIn) {
          sum += values[(up + 1) * stride + offset] ?? 0;
          weight++;
        }
      }
      if (hasDown) {
        const down = cell + width + shift;
        if (leftIn) {
          sum += values[down * stride + offset] ?? 0;
          weight++;
        }
        if (rightIn) {
          sum += values[(down + 1) * stride + offset] ?? 0;
          weight++;
        }
      }
      out[cell] = sum / weight;
    }
  }
  return out;
}

/**
 * The six cells touching cell `(col, row)` on the staggered raster: its row neighbours and the two
 * overlapping cells in each adjacent row, which sit half a cell left/right per the row parity.
 */
export function forEachStaggerNeighbour(
  col: number,
  row: number,
  width: number,
  height: number,
  visit: (cell: number) => void,
): void {
  if (col > 0) visit(row * width + col - 1);
  if (col < width - 1) visit(row * width + col + 1);
  const left = col - 1 + (row & 1);
  if (row > 0) visitPair(row - 1, left, width, visit);
  if (row < height - 1) visitPair(row + 1, left, width, visit);
}

function visitPair(row: number, left: number, width: number, visit: (cell: number) => void): void {
  if (left >= 0) visit(row * width + left);
  if (left + 1 < width) visit(row * width + left + 1);
}
