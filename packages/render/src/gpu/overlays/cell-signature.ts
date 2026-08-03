/** A half-cell lattice node. */
interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * Order-sensitive rolling hash of a cell list, chained from `seed` so a caller can fold several lists into
 * one 32-bit value. Only gates a cosmetic redraw: a collision costs one stale frame, never correctness.
 */
export function hashCells(cells: readonly Cell[], seed = 0): number {
  let h = seed | 0;
  for (const c of cells) {
    h = (Math.imul(h, 31) + Math.imul(c.col, 73856093) + Math.imul(c.row, 19349663)) | 0;
  }
  return h;
}
