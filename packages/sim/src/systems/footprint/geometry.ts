import type { BuildingFootprint, FootprintCell } from '@vinland/data';
import { contentIndex } from '../../core/content-index.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';

// The footprint GEOMETRY primitives — tile keys, cell distance, footprint-cell translation and the
// nearest-cell picks. The leaf of the footprint/ package (and of systems/ as a whole).

/** Injective per-tile key for a spatial set/bucket (integer tile `x`,`y`). A string so a consumer with
 *  no terrain handle (hence no map width) can still key by tile — and so a negative/off-map coordinate
 *  can never alias onto a real tile the way a numeric `y*width+x` packing would. Re-exported by
 *  shared.ts (whose `TileBuckets` keys with it); defined here because shared.ts already imports from
 *  this module, keeping the leaf import graph acyclic. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Integer Manhattan distance between two cells — the cheap reach/nearness heuristic the AI planner,
 *  combat range check, and herding leader-distance measure with (A* computes the real path cost).
 *  Defined here (the leaf module, for its nearest-cell picks) and re-exported by ./spatial.ts. */
export function manhattan(terrain: TerrainGraph, a: CellId, b: CellId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** The footprint of a building type, or undefined when the type is unknown or carries none. */
export function buildingFootprintOf(ctx: SystemContext, buildingType: number): BuildingFootprint | undefined {
  return contentIndex(ctx.content).buildings.get(buildingType)?.footprint;
}

/** Translate a footprint cell list to a building anchor, dropping cells outside the terrain grid
 *  (a border-hugging building simply blocks/reserves fewer cells than its template). */
export function translatedCells(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): CellId[] {
  const out: CellId[] = [];
  for (const c of cells) {
    const x = anchorX + c.dx;
    const y = anchorY + c.dy;
    if (terrain.inBounds(x, y)) out.push(terrain.cellAt(x, y));
  }
  return out;
}

export function translatedCellKeys(
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): Set<string> {
  const out = new Set<string>();
  for (const c of cells) out.add(tileKey(anchorX + c.dx, anchorY + c.dy));
  return out;
}

export function nearestCell(
  terrain: TerrainGraph,
  candidates: readonly CellId[],
  from: CellId | undefined,
): CellId | null {
  let best: CellId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cell of candidates) {
    const dist = from === undefined ? 0 : manhattan(terrain, from, cell);
    if (best === null || dist < bestDist || (dist === bestDist && cell < best)) {
      best = cell;
      bestDist = dist;
    }
  }
  return best;
}

export function nearestFreeNeighbour(
  terrain: TerrainGraph,
  anchor: CellId,
  blocked: ReadonlySet<CellId>,
  from: CellId | undefined,
): CellId | null {
  return nearestCell(
    terrain,
    terrain.walkableNeighbours(anchor).filter((cell) => !blocked.has(cell)),
    from,
  );
}

/** The 1-cell footprint a footprint-less building presents to placement checks. */
export const ANCHOR_ONLY: readonly FootprintCell[] = Object.freeze([{ dx: 0, dy: 0 }]);
