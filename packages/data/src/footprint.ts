import type { FootprintCell } from './schema/index.js';

/**
 * Collapse a `[GfxLandscape]`-style block-area table (`[state, x, y, run]` rows — the shape
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` decode to) to the FULL state's cells: the largest state
 * index is the fresh/full-grown object, and collision is conservatively static at that size (a
 * sapling reserves its grown tree's space). The ONE shared reading of the state axis — the sim's
 * resource footprints and the app's map-collision join both class by it, so the rule cannot drift
 * between them. Duplicate cells (overlapping run rows) are emitted once; malformed rows (missing
 * fields, non-positive run) contribute nothing.
 */
export function fullStateBlockAreaCells(areas: readonly (readonly number[])[] | undefined): FootprintCell[] {
  if (areas === undefined || areas.length === 0) return [];
  let fullState = 0;
  for (const [state] of areas) if (state !== undefined && state > fullState) fullState = state;
  const seen = new Set<string>();
  const out: FootprintCell[] = [];
  for (const [state, x, y, run] of areas) {
    if (state !== fullState || x === undefined || y === undefined || run === undefined || run <= 0) {
      continue;
    }
    for (let i = 0; i < run; i++) {
      const key = `${x + i},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ dx: x + i, dy: y });
    }
  }
  return out;
}
