import {
  type BuildingFootprint,
  type ContentSet,
  type FootprintCell,
  footprintCellDx,
  footprintCellMaxAbsDx,
} from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

// The footprint GEOMETRY primitives - node keys, node distance, footprint-cell translation and the
// nearest-cell picks. The leaf of systems/: it imports no sibling system module, which is why the shared
// node-metric helpers live here and reach the rest of systems/ re-exported through spatial/nodes.ts.

/** Injective per-node key for a spatial set/bucket (integer node `x`,`y`). A string so a consumer with no
 *  terrain handle (hence no map width) can still key by node, and so a negative or off-map coordinate can
 *  never alias onto a real node the way a numeric `y*width+x` packing would. */
export function nodeKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Whether two cell sets hold exactly the same nodes - the blocked-set memo verifiers' held-vs-fresh
 *  compare. */
export function sameCells(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false;
  for (const cell of a) if (!b.has(cell)) return false;
  return true;
}

/** Integer Manhattan distance between two nodes - the cheap reach and nearness measure, never a path
 *  cost (A* computes that). */
export function manhattan(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

// The offsets at Manhattan distance exactly `radius`: for each `dy` in `[-radius, radius]` the one or two
// columns `dx = ±(radius − |dy|)` tracing the diamond; radius 0 is `(0, 0)` alone. No bounds check and no
// pick - each caller keeps its own. Addressed by index rather than handed to a callback because every ring
// search accumulates a winner across the ring, and a callback would heap-allocate a closure per call to
// capture it. Offsets come ascending `(dy, dx)`, ascending node id on the row-major grid, but every current
// pick is order-independent (a min-id or a sort), so that order is pinned for reading, not load-bearing.
// The single-column rows take the two end indices, which is what leaves every pair starting at an odd `i`.

export function ringOffsetCount(radius: number): number {
  return radius === 0 ? 1 : 4 * radius;
}

export function ringOffsetDy(radius: number, i: number): number {
  if (radius === 0) return 0; // special-cased so `dy` is never the `-0` that `-radius` would mint
  if (i === 0) return -radius;
  if (i === ringOffsetCount(radius) - 1) return radius;
  return 1 - radius + ((i - 1) >> 1);
}

export function ringOffsetDx(radius: number, i: number): number {
  const dxMag = radius - Math.abs(ringOffsetDy(radius, i));
  if (dxMag === 0) return 0; // a plain 0, never the `-0` a bare `-dxMag` would mint
  return (i & 1) === 0 ? dxMag : -dxMag;
}

/** The footprint of a building type, or undefined when the type is unknown or carries none. Keyed by
 *  content (not a full SystemContext) so the placement-overlay probe can resolve footprints without a tick. */
export function buildingFootprintOf(
  content: ContentSet,
  buildingType: number,
): BuildingFootprint | undefined {
  return contentIndex(content).buildings.get(buildingType)?.footprint;
}

/** Translate a footprint cell list onto an anchor node, applying the odd-row parity shift
 *  (`footprintCellDx`) and dropping cells outside the terrain grid, so a border-hugging building simply
 *  blocks or reserves fewer cells than its template. */
export function translatedCells(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): NodeId[] {
  const out: NodeId[] = [];
  for (const c of cells) {
    const x = anchorX + footprintCellDx(anchorY, c);
    const y = anchorY + c.dy;
    if (terrain.inBounds(x, y)) out.push(terrain.nodeAt(x, y));
  }
  return out;
}

/** Compare nearest-candidate picks by distance, then canonical cell/node id - the one `(distance, id)`
 *  tie-break every nearest scan shares. */
export function closer(dist: number, cell: number, bestDist: number, bestCell: number): boolean {
  return dist < bestDist || (dist === bestDist && cell < bestCell);
}

/** The {@link closer} winner over a candidate list, measured from `from` (all candidates tie at 0 when
 *  `from` is undefined, so the min id wins). `accept` skips candidates (a taken melee slot, an occupied
 *  work cell); null when none qualify. */
export function nearestCell(
  terrain: TerrainGraph,
  candidates: readonly NodeId[],
  from: NodeId | undefined,
  accept?: (cell: NodeId) => boolean,
): NodeId | null {
  const fx = from === undefined ? 0 : terrain.xOf(from);
  const fy = from === undefined ? 0 : terrain.yOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const cell of candidates) {
    if (accept !== undefined && !accept(cell)) continue;
    const dist = from === undefined ? 0 : Math.abs(terrain.xOf(cell) - fx) + Math.abs(terrain.yOf(cell) - fy);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = cell;
      bestDist = dist;
      bestCell = cell;
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
 *  level-0 house reserves its top tier's space), or the bare anchor for a footprint-less type. Shared by
 *  the rule that REFUSES a flag here (`eachBlockerCell`'s OBSTACLE channel) and the push-out that CLEARS
 *  one from here (`evictWorkFlagsFromFootprint`), so a placement cannot leave a flag on ground the plant
 *  rule rejects. */
export function buildingFlagBody(content: ContentSet, buildingType: number): readonly FootprintCell[] {
  const fp = buildingFootprintOf(content, buildingType);
  return fp?.familyBody.length ? fp.familyBody : ANCHOR_ONLY;
}

/** A building's reserved build-exclusion zone as {@link NodeId}s. See {@link reservedZoneOf}. */
export interface ReservedZone {
  readonly zone: ReadonlySet<NodeId>;
  /** Chebyshev bound of the reserved cells - the box `reach` a region-index `near` query must span to be a
   *  provable superset of the zone. */
  readonly reach: number;
}

/**
 * The reserved build-exclusion zone of a building anchored at half-cell `(anchorHx, anchorHy)`: its type's
 * `reserved` footprint cells, or the bare anchor for a footprint-less type, translated onto the anchor.
 * Undefined when the zone is empty, which needs a fully off-grid anchor.
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
  let reach = 0;
  for (const c of cells) reach = Math.max(reach, footprintCellMaxAbsDx(c), Math.abs(c.dy));
  return { zone, reach };
}
