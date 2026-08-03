/** A placements lane is a flat run of `[hx, hy, typeIndex]` half-cell triples (the original's `emla`
 *  lane; `@open-northland/data` validates its length to a multiple of this stride). */
const PLACEMENT_STRIDE = 3;

/**
 * Visit each `[hx, hy, typeIndex]` placement in order, with its triplet `ordinal` (the placement index
 * `i / stride`, the parallel `levels` lane's key and the static→dynamic handover join key). Stops at the
 * first partial triple, so a truncated lane degrades instead of yielding `undefined` coordinates.
 */
export function forEachPlacement(
  placements: readonly number[],
  visit: (hx: number, hy: number, typeIndex: number, ordinal: number) => void,
): void {
  for (let i = 0; i + (PLACEMENT_STRIDE - 1) < placements.length; i += PLACEMENT_STRIDE) {
    const hx = placements[i];
    const hy = placements[i + 1];
    const typeIndex = placements[i + 2];
    if (hx === undefined || hy === undefined || typeIndex === undefined) break;
    visit(hx, hy, typeIndex, i / PLACEMENT_STRIDE);
  }
}
