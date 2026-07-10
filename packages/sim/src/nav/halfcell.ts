/**
 * HALF-CELL ↔ POSITION conversions — the single seam between the sim's fixed-point positions
 * (fractional VISUAL-TILE coords: `x` = column, `y` = row, stagger applied by the projection) and
 * the navigation lattice's integer HALF-CELL nodes (the original's `2W×2H` grid — source basis: the
 * decoded map lanes `lmlt`/`emla`/`lmlv` and `map.cif` StaticObjects all address this grid).
 *
 * The half-cell grid is RECTANGULAR in world space: node `(hx, hy)` sits at world
 * `(hx·½ column, hy·½ row)` — no stagger of its own; the visual stagger arises from WHICH nodes the
 * cell centres occupy (cell `(c, r)` sits at node `(2c + (r&1), 2r)`, the render's
 * `halfCellToScreen` twin). Every integer grid coordinate inside the sim (commands, footprints,
 * NodeBuckets keys, `NodeId`s) is a half-cell coordinate; these helpers are how a fractional
 * Position enters and leaves that grid. Pure fixed-point — quarters of ONE are exact.
 */
import { type Fixed, fx } from '../core/fixed.js';
import { staggerShift, worldX } from './metric.js';

const TWO: Fixed = fx.fromInt(2);

/** An integer half-cell node address on the `2W×2H` navigation lattice. */
export interface HalfCellNode {
  readonly hx: number;
  readonly hy: number;
}

/**
 * The half-cell node a fixed-point position occupies — its world coordinates scaled to half-cell
 * units and truncated (the same floor-until-arrival semantics `fx.toInt` gave the old full-cell
 * snap; a position standing exactly on a node maps to it exactly, quarters being exact in fixed
 * point). Callers clamp into the grid via `TerrainGraph.nodeAtClamped`, so a border-seam transient
 * (world x briefly < 0 on a west-border leg) truncates to 0 harmlessly.
 */
export function nodeOfPosition(x: Fixed, y: Fixed): HalfCellNode {
  return { hx: fx.toInt(fx.mul(worldX(x, y), TWO)), hy: fx.toInt(fx.mul(y, TWO)) };
}

/**
 * The fixed-point Position of a half-cell node's centre: row `hy/2`, and `x` = the node's world
 * column `hx/2` with that row's stagger shift removed (the projection re-adds it). Exact: ONE is
 * divisible by 4, and the stagger at a half-integer row is exactly ¼.
 */
export function positionOfNode(hx: number, hy: number): { x: Fixed; y: Fixed } {
  const y = fx.div(fx.fromInt(hy), TWO);
  return { x: positionXOfWorld(fx.div(fx.fromInt(hx), TWO), y), y };
}

/**
 * The Position `x` of a WORLD column coordinate at row `y` — the stagger shift removed (the
 * projection re-adds it). The off-lattice twin of {@link positionOfNode} for points BETWEEN nodes
 * (e.g. a diagonal leg's seam waypoint at an edge midpoint), so the stagger-removal convention has
 * exactly one owner.
 */
export function positionXOfWorld(wx: Fixed, y: Fixed): Fixed {
  return fx.sub(wx, staggerShift(y));
}

/**
 * The half-cell node of a VISUAL-TILE centre `(cx, cy)` — `(2cx + (cy&1), 2cy)`, the stagger made
 * integral. The authoring seam: scenes and sandbox helpers keep placing content by whole tiles, and
 * this is where a tile address becomes the node the sim actually anchors on.
 */
export function cellAnchorNode(cx: number, cy: number): HalfCellNode {
  return { hx: 2 * cx + (cy & 1), hy: 2 * cy };
}
