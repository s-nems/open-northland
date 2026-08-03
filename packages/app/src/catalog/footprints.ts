import type { BuildingFootprint, FootprintCell } from '@open-northland/data';

/**
 * Hand-authored approximate building footprints for the global sandbox content: rectangles sized by
 * building class, standing in for the extracted `[GfxHouse]` cell tables that the real-content path loads
 * at runtime and that override these. Approximated, source basis "Building placement": a body plus an
 * exclusion margin, checked body against zone, so every mode gets working placement collision.
 *
 * Units: `FootprintCell` offsets are half-cell nodes, so these invented extents are doubled.
 *
 * `blocked` stays empty on purpose, since walk-blocking walls come only from the real extracted
 * footprints. The approximate `door` gives a settler a front entry cell instead of the building centre.
 */

/** Body half-extent per building class, in half-cell nodes: the body spans `(2n+1)²` nodes centred
 *  on the anchor. */
const BODY_HALF_EXTENT: Readonly<Record<string, number>> = {
  home: 2, // ≈3×3 cells
  workplace: 2, // ≈3×3 cells
  tower: 2, // ≈3×3 cells - slim but tall; the ground ring still needs clearance
  storage: 4, // ≈5×5 cells - warehouses and the headquarters
  training: 4, // ≈5×5 cells - barracks and school halls
};
const DEFAULT_BODY_HALF_EXTENT = 2;
/** The build-exclusion ring beyond the body: one cell, the tightest packing the rule allows. */
const MARGIN = 2;

function square(halfExtent: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let dy = -halfExtent; dy <= halfExtent; dy++) {
    for (let dx = -halfExtent; dx <= halfExtent; dx++) cells.push({ dx, dy });
  }
  return cells;
}

/** The approximate footprint for a building class. */
export function approximateFootprint(kind: string): BuildingFootprint {
  const body = BODY_HALF_EXTENT[kind] ?? DEFAULT_BODY_HALF_EXTENT;
  return {
    blocked: [],
    familyBody: square(body),
    reserved: square(body + MARGIN),
    // The front-centre node of the body edge, where a settler stands to enter; `+dy` faces the viewer.
    door: { dx: 0, dy: body },
  };
}
