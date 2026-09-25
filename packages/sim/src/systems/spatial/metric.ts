import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** Injective per-node key for a spatial set/bucket (integer node `x`,`y`). A string so a consumer with no
 *  terrain handle (hence no map width) can still key by node, and so a negative or off-map coordinate can
 *  never alias onto a real node the way a numeric `y*width+x` packing would. */
export function nodeKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Integer Manhattan distance between two nodes - the cheap reach and nearness measure, never a path
 *  cost (A* computes that). */
export function manhattan(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** The original's map-point distance between two nodes ({@link hexDistanceBetween}), which its combat radii
 *  and leashes count in. */
export function hexNodeDistance(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  return hexDistanceBetween(terrain.xOf(a), terrain.yOf(a), terrain.xOf(b), terrain.yOf(b));
}

// The offsets at Manhattan distance exactly `radius`: for each `dy` in `[-radius, radius]` the one or two
// columns `dx = ±(radius − |dy|)` tracing the diamond; radius 0 is `(0, 0)` alone. No bounds check and no
// pick - each caller keeps its own. Addressed by index rather than handed to a callback because every ring
// search accumulates a winner across the ring, and a callback would heap-allocate a closure per call to
// capture it. Offsets come ascending `(dy, dx)`, ascending node id on the row-major grid: the farm's sow
// draw takes the first candidates as the canonical nearest, so that order is load-bearing and pinned by
// its test. The single-column rows take the two end indices, which is what leaves every pair starting at
// an odd `i`.

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
