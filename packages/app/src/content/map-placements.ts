/**
 * The one iterator over a decoded map's `objects.placements` lane — a flat run of `[hx, hy, typeIndex]`
 * triples (the original's `emla` half-cell placements; layout owned by `@open-northland/data`'s terrain
 * schema). It owns the triple stride and the bounds/undefined handling so the object, collision and
 * resource joins read placements one way instead of each re-deriving `i += 3` / `i / 3`.
 */

/** A placements lane is a flat run of `[hx, hy, typeIndex]` triples (source basis: `@open-northland/data`
 *  terrain `objects.placements`, validated to a multiple of this stride). */
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
