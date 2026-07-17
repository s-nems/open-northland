import { type Fixed, fx, ZERO } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../metric.js';
import type { TerrainGraph } from './graph.js';
import type { NodeId } from './types.js';

/**
 * The fixed-point half-cell lattice step distance between two nodes — the admissible, consistent A*
 * heuristic for the 8-direction graph ({@link TerrainGraph.steps}: E/W cost {@link HALF_COLUMN},
 * diagonal {@link DIAGONAL_STEP}, vertical {@link HALF_ROW}), and the exact minimum cost across open
 * terrain. With `ax = |Δhx|` (half-columns) and `ay = |Δhy|` (half-rows): a diagonal covers `(1, 2)`
 * and is cheaper than its straight substitute `E + 2·N` (DIAGONAL_STEP < HALF_COLUMN + 2·HALF_ROW),
 * so use as many diagonals as either axis allows — `d = min(ax, ⌊ay/2⌋)` — and cover the remainder
 * with straight steps:
 *
 *  - `2·ax ≤ ay` (vertical dominates): `ax·DIAGONAL_STEP + (ay − 2ax)·HALF_ROW`;
 *  - otherwise (sideways dominates): `⌊ay/2⌋·DIAGONAL_STEP + (ax − ⌊ay/2⌋)·HALF_COLUMN +
 *    (ay mod 2)·HALF_ROW`.
 *
 * No wasteful composition beats it: a zigzag diagonal pair covering one column costs
 * 2·DIAGONAL_STEP > 2·HALF_COLUMN, an opposing pair covering four rows costs 2·DIAGONAL_STEP >
 * 4·HALF_ROW, and a diagonal-plus-backtrack substitute for one E step costs DIAGONAL_STEP +
 * 2·HALF_ROW > HALF_COLUMN. So on unit-cost terrain the heuristic equals the true open-terrain graph
 * distance (admissible and consistent); obstacles only raise the true cost, so A* stays optimal.
 *
 * The readable two-node form. A* itself calls {@link latticeDistanceTo}, which hoists the goal's
 * coordinates out of the loop; this wrapper is what the metric's tests and diagnostics read.
 */
export function nodeLatticeDistance(g: TerrainGraph, a: NodeId, b: NodeId): Fixed {
  return latticeDistanceTo(g, g.xOf(b), g.yOf(b), a);
}

/**
 * {@link nodeLatticeDistance} with one endpoint already resolved to coordinates — the form A* calls
 * per discovered node, since the goal's coordinates are a loop invariant of a search.
 */
export function latticeDistanceTo(g: TerrainGraph, bx: number, by: number, a: NodeId): Fixed {
  const ax = Math.abs(bx - g.xOf(a));
  const ay = Math.abs(by - g.yOf(a));
  if (2 * ax <= ay) {
    // Vertical dominates: every half-column crosses diagonally, the leftover rows are half-row steps.
    return fx.add(fx.mul(fx.fromInt(ax), DIAGONAL_STEP), fx.mul(fx.fromInt(ay - 2 * ax), HALF_ROW));
  }
  // Sideways dominates: ⌊ay/2⌋ diagonals absorb the rows (one half-row may remain when ay is odd),
  // the leftover offset is half-column steps.
  const d = ay >> 1;
  const straight = fx.mul(fx.fromInt(ax - d), HALF_COLUMN);
  const oddRow = (ay & 1) === 1 ? HALF_ROW : ZERO;
  return fx.add(fx.add(fx.mul(fx.fromInt(d), DIAGONAL_STEP), straight), oddRow);
}
