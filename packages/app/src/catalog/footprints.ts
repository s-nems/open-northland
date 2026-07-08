import type { BuildingFootprint, FootprintCell } from '@vinland/data';

/**
 * CLEAN-ROOM approximate building footprints for the global sandbox content — rectangles sized by
 * building class, NOT the extracted `[GfxHouse]` cell tables (those are decoded game data, which never
 * enters the repo; the live real-content path loads them from the gitignored `content/ir.json` at
 * runtime and they OVERRIDE these). Approximated, source basis "Building placement": the original
 * blocks placement by per-type walk/build areas; these stand-ins reproduce the RULE (a body plus a
 * one-cell exclusion margin, checked body-vs-zone) at plausible per-class sizes so every mode — scenes,
 * the vertical slice, a bare checkout — gets working placement collision and a truthful build overlay.
 *
 * Deliberately `blocked: []` and no door: the approximations gate PLACEMENT only. Walk-blocking walls
 * and door-cell interaction come exclusively from the real extracted footprints, so synthetic scenes'
 * routing, job arrival and pinned goldens are untouched by the approximation.
 */

/** Body half-extent per building class: the body spans `(2n+1)²` cells centred on the anchor. */
const BODY_HALF_EXTENT: Readonly<Record<string, number>> = {
  home: 1, // 3×3 — a house
  workplace: 1, // 3×3 — a workshop
  tower: 1, // 3×3 — a defence tower (slim but tall; the ground ring still needs clearance)
  storage: 2, // 5×5 — warehouses + the headquarters (the original's largest common bodies)
  training: 2, // 5×5 — barracks/school halls
};
const DEFAULT_BODY_HALF_EXTENT = 1;
/** The build-exclusion ring beyond the body — one cell, the tightest packing the rule allows. */
const MARGIN = 1;

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
  };
}
