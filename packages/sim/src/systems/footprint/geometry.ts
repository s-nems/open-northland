import type { BuildingFootprint, ContentSet, FootprintCell } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

// The footprint GEOMETRY primitives — node keys, node distance, footprint-cell translation and the
// nearest-cell picks. The leaf of the footprint/ package (and of systems/ as a whole).

/** Injective per-node key for a spatial set/bucket (integer node `x`,`y`). A string so a consumer with
 *  no terrain handle (hence no map width) can still key by node — and so a negative/off-map coordinate
 *  can never alias onto a real node the way a numeric `y*width+x` packing would. Re-exported by
 *  spatial.ts (whose `NodeBuckets` keys with it); defined here because spatial.ts already imports from
 *  this package, keeping the leaf import graph acyclic. */
export function nodeKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Integer Manhattan distance between two nodes — the cheap reach/nearness heuristic the AI planner,
 *  combat range check, and herding leader-distance measure with (A* computes the real path cost).
 *  Defined here (the leaf module, for its nearest-cell picks) and re-exported by ./spatial.ts. */
export function manhattan(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** The footprint of a building type, or undefined when the type is unknown or carries none. Keyed by
 *  content (not a full SystemContext) so the placement-overlay probe can resolve footprints without a tick. */
export function buildingFootprintOf(
  content: ContentSet,
  buildingType: number,
): BuildingFootprint | undefined {
  return contentIndex(content).buildings.get(buildingType)?.footprint;
}

/** Translate a footprint cell list to a building anchor, dropping cells outside the terrain grid
 *  (a border-hugging building simply blocks/reserves fewer cells than its template). */
export function translatedCells(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): NodeId[] {
  const out: NodeId[] = [];
  for (const c of cells) {
    const x = anchorX + c.dx;
    const y = anchorY + c.dy;
    if (terrain.inBounds(x, y)) out.push(terrain.nodeAt(x, y));
  }
  return out;
}

export function nearestCell(
  terrain: TerrainGraph,
  candidates: readonly NodeId[],
  from: NodeId | undefined,
): NodeId | null {
  let best: NodeId | null = null;
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
  anchor: NodeId,
  blocked: ReadonlySet<NodeId>,
  from: NodeId | undefined,
): NodeId | null {
  return nearestCell(
    terrain,
    terrain.walkableNeighbours(anchor).filter((cell) => !blocked.has(cell)),
    from,
  );
}

/** The 1-cell footprint a footprint-less building presents to placement checks. */
export const ANCHOR_ONLY: readonly FootprintCell[] = Object.freeze([{ dx: 0, dy: 0 }]);

/** The cells of `buildingType` that a work flag may not occupy, anchor-relative: its family body (a
 *  level-0 house reserves its top tier's space), or the bare anchor for a footprint-less type. One
 *  definition so the rule that REFUSES a flag here (`eachBlockerCell`'s OBSTACLE channel) and the
 *  push-out that CLEARS one from here (`evictWorkFlagsFromFootprint`) cannot drift apart — were they to,
 *  a placement would leave a flag on ground the plant rule rejects. */
export function buildingFlagBody(content: ContentSet, buildingType: number): readonly FootprintCell[] {
  const fp = buildingFootprintOf(content, buildingType);
  return fp?.familyBody.length ? fp.familyBody : ANCHOR_ONLY;
}
