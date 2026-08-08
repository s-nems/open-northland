import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';
import type { TerrainGraph } from './graph.js';
import type { NodeId } from './node-id.js';

/**
 * The fixed-point half-cell lattice step distance between two nodes, the A* heuristic for the
 * 8-direction graph. With `ax` half-columns and `ay` half-rows apart, a diagonal covers `(1, 2)` for
 * less than its straight substitute `E + 2*N`, so the cheapest walk takes `min(ax, floor(ay/2))`
 * diagonals and covers the remainder straight. Every wasteful composition costs strictly more, so on
 * unit-cost terrain this equals the true open-terrain graph distance and the heuristic is admissible and
 * consistent. Obstacles only raise the true cost, so A* stays optimal.
 */
export function nodeLatticeDistance(g: TerrainGraph, a: NodeId, b: NodeId): Fixed {
  return latticeDistanceTo(g, g.xOf(b), g.yOf(b), a);
}

/**
 * {@link nodeLatticeDistance} with one endpoint already resolved to coordinates, since the goal's
 * coordinates are a loop invariant of an A* search.
 */
export function latticeDistanceTo(g: TerrainGraph, bx: number, by: number, a: NodeId): Fixed {
  const ax = Math.abs(bx - g.xOf(a));
  const ay = Math.abs(by - g.yOf(a));
  if (2 * ax <= ay) {
    // Vertical dominates: every half-column crosses diagonally, the leftover rows are half-row steps.
    return fx.add(fx.mul(fx.fromInt(ax), DIAGONAL_STEP), fx.mul(fx.fromInt(ay - 2 * ax), HALF_ROW));
  }
  // Sideways dominates: the diagonals absorb the rows, leaving one half-row when `ay` is odd.
  const d = ay >> 1;
  const straight = fx.mul(fx.fromInt(ax - d), HALF_COLUMN);
  const oddRow = (ay & 1) === 1 ? HALF_ROW : ZERO;
  return fx.add(fx.add(fx.mul(fx.fromInt(d), DIAGONAL_STEP), straight), oddRow);
}
