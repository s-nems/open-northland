/** A half-cell node with integer lattice coords — the shape both the placement wash and the construction
 *  plot hash to gate their per-frame redraw. */
interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * A cheap order-sensitive rolling hash of a `(col,row)` cell list, chained from `seed` so a caller can fold
 * several lists (or mix in a count) into one value. The prime multipliers are the standard spatial-hash
 * triple; `| 0` keeps it a 32-bit int. Only gates a cosmetic redraw — a collision between two different
 * same-length sets is tolerated (one stale frame, self-correcting on the next change), never correctness.
 */
export function hashCells(cells: readonly Cell[], seed = 0): number {
  let h = seed | 0;
  for (const c of cells) {
    h = (Math.imul(h, 31) + Math.imul(c.col, 73856093) + Math.imul(c.row, 19349663)) | 0;
  }
  return h;
}
