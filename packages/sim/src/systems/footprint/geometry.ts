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

/** Whether two cell sets hold exactly the same nodes — the blocked-set memo verifiers' held-vs-fresh
 *  compare (building/resource blocked caches, the work-flag blocked set). */
export function sameCells(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false;
  for (const cell of a) if (!b.has(cell)) return false;
  return true;
}

/** Integer Manhattan distance between two nodes — the cheap reach/nearness heuristic the AI planner,
 *  combat range check, and herding leader-distance measure with (A* computes the real path cost).
 *  Defined here (the leaf module, for its nearest-cell picks) and re-exported by ./spatial.ts. */
export function manhattan(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/**
 * Visit every offset at Manhattan distance exactly `radius` — for each `dy` in `[-radius, radius]` the
 * one or two columns `dx = ±(radius − |dy|)` tracing the diamond; radius 0 visits `(0, 0)` alone. The
 * shared ring-geometry step of every expanding Manhattan ring search (NodeBuckets.nearest, the
 * interaction-cell index, the yard/spill searches, work-flag placement); each caller keeps its own
 * bounds policy and per-node pick. Offsets come ascending `(dy, dx)` — ascending node id on the
 * row-major grid — but every current pick is order-independent (a min-id or a sort), so the order is
 * pinned for reading, not load-bearing.
 */
export function forEachRingOffset(radius: number, visit: (dx: number, dy: number) => void): void {
  if (radius === 0) {
    visit(0, 0); // special-cased so no offset is ever the negated zero `-radius` would mint
    return;
  }
  for (let dy = -radius; dy <= radius; dy++) {
    const dxMag = radius - Math.abs(dy);
    if (dxMag === 0) {
      visit(0, dy);
    } else {
      visit(-dxMag, dy);
      visit(dxMag, dy);
    }
  }
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

/** A building's reserved build-exclusion zone as {@link NodeId}s, plus the Chebyshev {@link ReservedZone.reach}
 *  a region-index box query needs to cover it. See {@link reservedZoneOf}. */
export interface ReservedZone {
  readonly zone: ReadonlySet<NodeId>;
  /** Chebyshev bound of the reserved cells — the box `reach` a region-index `near` query must span to be a
   *  provable superset of the zone. */
  readonly reach: number;
}

/**
 * The reserved build-exclusion zone of a building placed with its anchor at half-cell `(anchorHx, anchorHy)`:
 * its type's `reserved` footprint cells (or the bare anchor for a footprint-less type) translated onto the
 * anchor as a {@link NodeId} set, plus the Chebyshev `reach` a region-index box query must span to cover it.
 * The placement-time decor-razing passes (berry bushes, felled-tree stumps) share it so a placed building
 * clears every landscape decoration it lands on from one zone definition. Undefined when the zone is empty
 * (a fully off-grid anchor).
 */
export function reservedZoneOf(
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
  anchorHx: number,
  anchorHy: number,
): ReservedZone | undefined {
  const cells = buildingFootprintOf(content, buildingType)?.reserved ?? ANCHOR_ONLY;
  const zone = new Set<NodeId>(translatedCells(terrain, cells, anchorHx, anchorHy));
  if (zone.size === 0) return undefined;
  let reach = 0; // Chebyshev bound of the reserved cells → a provable superset the box query can't miss
  for (const c of cells) reach = Math.max(reach, Math.abs(c.dx), Math.abs(c.dy));
  return { zone, reach };
}
