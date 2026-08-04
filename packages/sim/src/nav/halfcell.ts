/**
 * The single seam between fixed-point positions (fractional visual-tile coordinates, stagger applied by
 * the projection) and the navigation lattice's integer half-cell nodes. Source basis: the decoded map
 * lanes `lmlt`, `emla`, `lmlv` and `map.cif` StaticObjects all address the original's `2W x 2H` grid.
 *
 * The half-cell grid is rectangular in world space: node `(hx, hy)` sits at world `(hx/2 column,
 * hy/2 row)` and carries no stagger of its own. The visual stagger comes from which nodes the cell
 * centres occupy, cell `(c, r)` sitting at node `(2c + (r&1), 2r)`. Every integer grid coordinate inside
 * the sim is a half-cell coordinate. Pure fixed-point, and quarters of ONE are exact.
 */
import { type Fixed, fx } from '../core/fixed.js';
import { staggerShift, worldX } from './world-metric.js';

const TWO: Fixed = fx.fromInt(2);

/** An integer half-cell node address on the `2W×2H` navigation lattice. */
export interface HalfCellNode {
  readonly hx: number;
  readonly hy: number;
}

/**
 * The half-cell node a fixed-point position occupies: its world coordinates scaled to half-cell units and
 * truncated, so a position standing exactly on a node maps to it exactly. The result is unclamped, and
 * callers clamp into the grid through `TerrainGraph.nodeAtClamped`.
 */
export function nodeOfPosition(x: Fixed, y: Fixed): HalfCellNode {
  return { hx: nodeHxOfPosition(x, y), hy: nodeHyOfPosition(y) };
}

/** {@link nodeOfPosition}'s `hx` alone, for per-tick loops where minting a node object per call is
 *  measured churn. */
export function nodeHxOfPosition(x: Fixed, y: Fixed): number {
  return fx.toInt(fx.mul(worldX(x, y), TWO));
}

/** {@link nodeOfPosition}'s `hy` alone. It depends only on the row. */
export function nodeHyOfPosition(y: Fixed): number {
  return fx.toInt(fx.mul(y, TWO));
}

/**
 * The fixed-point Position of a half-cell node's centre: row `hy/2`, and `x` the node's world column
 * `hx/2` with that row's stagger shift removed, which the projection re-adds. Exact, because ONE divides
 * by 4 and the stagger at a half-integer row is exactly a quarter.
 */
export function positionOfNode(hx: number, hy: number): { x: Fixed; y: Fixed } {
  const y = fx.div(fx.fromInt(hy), TWO);
  return { x: positionXOfWorld(fx.div(fx.fromInt(hx), TWO), y), y };
}

/**
 * The Position `x` of a world column coordinate at row `y`, stagger shift removed. The off-lattice twin
 * of {@link positionOfNode}, for points between nodes.
 */
export function positionXOfWorld(wx: Fixed, y: Fixed): Fixed {
  return fx.sub(wx, staggerShift(y));
}

/** The half-cell node of a visual-tile centre: `(2cx + (cy&1), 2cy)`, the stagger made integral. */
export function cellAnchorNode(cx: number, cy: number): HalfCellNode {
  return { hx: 2 * cx + (cy & 1), hy: 2 * cy };
}

/**
 * The visual tile whose centre is node `(hx, hy)`, inverting {@link cellAnchorNode}. Exact only for a
 * centre node, since a node between centres has no tile of its own. This is not the question of which
 * cell owns a node.
 */
export function cellOfAnchorNode(hx: number, hy: number): { readonly cx: number; readonly cy: number } {
  const cy = hy / 2;
  return { cx: (hx - (cy & 1)) / 2, cy };
}

/**
 * Whether two nodes are the same or neighbouring lattice points (Chebyshev distance at most 1).
 * Observation: a paired interaction in the original leaves no free node between the two participants.
 */
export function nodesAdjacent(a: HalfCellNode, b: HalfCellNode): boolean {
  return Math.abs(a.hx - b.hx) <= 1 && Math.abs(a.hy - b.hy) <= 1;
}
