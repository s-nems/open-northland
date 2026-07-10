import type { BuildingFootprint, FootprintCell } from '@vinland/data';

/**
 * CLEAN-ROOM approximate building footprints for the global sandbox content — rectangles sized by
 * building class, NOT the extracted `[GfxHouse]` cell tables (those are decoded game data, which never
 * enters the repo; the live real-content path loads them from the gitignored `content/ir.json` at
 * runtime and they OVERRIDE these). Approximated, source basis "Building placement": the original
 * blocks placement by per-type walk/build areas; these stand-ins reproduce the RULE (a body plus an
 * exclusion margin, checked body-vs-zone) at plausible per-class sizes so every mode — scenes,
 * the vertical slice, a bare checkout — gets working placement collision and a truthful build overlay.
 *
 * UNITS: `FootprintCell` offsets are HALF-CELL nodes (the real footprint tables' own resolution), so
 * these invented extents are DOUBLED versus their old cell-unit values — the same world-extent-
 * preserving ×2 the invented combat radii got — or a bare-checkout scene would pack buildings twice
 * as densely as the rule it stands in for.
 *
 * Deliberately `blocked: []` (no walk-blocking walls — those come only from the real extracted
 * footprints, so synthetic scenes' routing and pinned goldens are untouched). It DOES carry an
 * approximate `door` though: a front-of-body entry cell so a settler walks to a real doorway to staff /
 * enter a building (the sim's {@link interactionNode}) and the door-badge anchors beside it, instead of
 * both falling back to the building's centre. Approximated, source basis "Building placement" — the RULE
 * (settlers enter at a front door) at a plausible per-class spot, not the extracted `LogicDoorPoint`.
 */

/** Body half-extent per building class, in half-cell nodes: the body spans `(2n+1)²` nodes centred
 *  on the anchor — n = 2 covers the world extent the old one-CELL half-extent did. */
const BODY_HALF_EXTENT: Readonly<Record<string, number>> = {
  home: 2, // ≈3×3 cells — a house
  workplace: 2, // ≈3×3 cells — a workshop
  tower: 2, // ≈3×3 cells — a defence tower (slim but tall; the ground ring still needs clearance)
  storage: 4, // ≈5×5 cells — warehouses + the headquarters (the original's largest common bodies)
  training: 4, // ≈5×5 cells — barracks/school halls
};
const DEFAULT_BODY_HALF_EXTENT = 2;
/** The build-exclusion ring beyond the body — one CELL (two nodes), the tightest packing the rule allows. */
const MARGIN = 2;

function square(halfExtent: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let dy = -halfExtent; dy <= halfExtent; dy++) {
    for (let dx = -halfExtent; dx <= halfExtent; dx++) cells.push({ dx, dy });
  }
  return cells;
}

/** The approximate footprint for a building class (see the module doc). */
export function approximateFootprint(kind: string): BuildingFootprint {
  const body = BODY_HALF_EXTENT[kind] ?? DEFAULT_BODY_HALF_EXTENT;
  return {
    blocked: [], // placement-only approximation — never walk-blocks (see the module doc)
    familyBody: square(body),
    reserved: square(body + MARGIN),
    // A front-of-body door: the front-centre node of the body edge (`+dy` is toward the viewer in the
    // staggered projection), where a settler stands to enter. Just the interaction/badge anchor — with
    // no walls it isn't a passable gate, only "where the door is".
    door: { dx: 0, dy: body },
  };
}
