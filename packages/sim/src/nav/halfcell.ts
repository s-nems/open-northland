/**
 * The single seam between fixed-point positions (fractional visual-tile coordinates, stagger applied by
 * the projection) and the navigation lattice's integer half-cell nodes. Node `(hx, hy)` sits at world
 * column `hx/2`, a quarter column further east on an odd `hy`: original behavior, the original's own
 * map-point projection. Every integer grid coordinate inside the sim is a half-cell coordinate.
 */
import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import { type Fixed, fx, ONE, ULP, ZERO } from '../core/fixed.js';
import { QUARTER_COLUMN, ROW_STEP, staggerShift, worldX } from './world-metric.js';

const TWO: Fixed = fx.fromInt(2);
const HALF_ONE: Fixed = fx.div(ONE, TWO);

/** An integer half-cell node address on the `2W×2H` navigation lattice. */
export interface HalfCellNode {
  readonly hx: number;
  readonly hy: number;
}

/** An inclusive box of half-cell nodes; its corners may lie off the map. */
export interface NodeArea {
  readonly minHx: number;
  readonly minHy: number;
  readonly maxHx: number;
  readonly maxHy: number;
}

/**
 * The half-cell node a fixed-point position occupies: the nearest node by screen distance (world column
 * plus row scaled by {@link ROW_STEP}) among the nearest node of each row bracketing it, one row when it
 * lies on a row. Along every lattice edge that reads the edge's start until half progress and its end
 * after. A column step (`pathfinding/straight-steps.ts`) passes the skipped row between two of its nodes,
 * which lie nearer there than the step's own ends. Between a node's row and the row its column step skips,
 * a position reads that node while its sideways offset from the node's column line is under both
 * {@link COLUMN_LINE_TOLERANCE} and its screen distance from the skipped row; otherwise it reads the
 * nearest node, which keeps a body pushed sideways off a node reading it. So a position on the line reads
 * the step's start or end everywhere but exactly on the skipped row, while one held off the line reads a
 * skipped node in a band around that row as wide as its offset. A mover on a live column step therefore
 * reads its node through `moverNode` (`systems/spatial/mover-node.ts`), which takes the step's own ends
 * whatever its offset. Original behavior: a mover's node switches from start to destination at half
 * progress and is never another node.
 *
 * Ties: on a row the west node wins, between rows the north one. So an E/W edge's midpoint reads its west
 * node, and a position exactly on a column step's skipped row reads that row's west node beside it. The
 * result is unclamped, and callers clamp into the grid through `TerrainGraph.nodeAtClamped`.
 */
export function nodeOfPosition(x: Fixed, y: Fixed): HalfCellNode {
  locateNode(x, y);
  return { hx: located.hx, hy: located.hy };
}

/** {@link nodeOfPosition}'s `hx` alone, so a per-tick loop allocates no node object per call. */
export function nodeHxOfPosition(x: Fixed, y: Fixed): number {
  locateNode(x, y);
  return located.hx;
}

/** {@link nodeOfPosition}'s `hy` alone. Called right after {@link nodeHxOfPosition} for the same position,
 *  it reuses that call's result. */
export function nodeHyOfPosition(x: Fixed, y: Fixed): number {
  locateNode(x, y);
  return located.hy;
}

/** Half the width of the strip around a column step's line inside which a position reads the step's own
 *  ends away from the skipped row, in column units: 1/16 column, 4.25 px. Wide enough for a push or the
 *  helm holding a body off the line, narrow enough that a slant edge leaves its start's strip well before
 *  half progress. */
const COLUMN_LINE_TOLERANCE: Fixed = fx.div(ONE, fx.fromInt(16));

/** The nodes a position stands between, as {@link nodesBesidePosition} writes them. */
export interface NodesBeside {
  northHx: number;
  northHy: number;
  southHx: number;
  southHy: number;
}

/**
 * The nodes position `(x, y)` stands between: the nearest node of each row bracketing it, the west one on
 * a tie, or the node it lies on twice on a row. Walking on from between rows a body reads either, as the
 * nearer one changes with its column. Written into `out`, allocation-free.
 */
export function nodesBesidePosition(x: Fixed, y: Fixed, out: NodesBeside): void {
  locateNode(x, y);
  out.northHx = located.northHx;
  out.northHy = located.northHy;
  out.southHx = located.southHx;
  out.southHy = located.southHy;
}

/** The position {@link located} answers. Module variables, read in fewer bytecodes than a field, which
 *  keeps {@link locateNode} under the size the optimizer inlines for free. */
let locatedX: Fixed | undefined;
let locatedY: Fixed | undefined;

/** {@link locateNode}'s result, reused so the per-entity per-tick node reads allocate nothing and an `hx`
 *  then `hy` read of one position computes once. */
const located = {
  hx: 0,
  hy: 0,
  northHx: 0,
  northHy: 0,
  southHx: 0,
  southHy: 0,
};

/** Write {@link nodeOfPosition}'s node, and the nodes {@link nodesBesidePosition} names, into
 *  {@link located}. Only the test for the position already held, small enough for a caller to inline. */
function locateNode(x: Fixed, y: Fixed): void {
  if (x !== locatedX || y !== locatedY) locateFresh(x, y);
}

/** {@link locateNode} for a position not held. */
function locateFresh(x: Fixed, y: Fixed): void {
  locatedX = x;
  locatedY = y;
  const wx = worldX(x, y);
  // Doubled by an add: `fx.mul(v, TWO)` exactly, without the product, on a per-entity per-tick path.
  const northHy = Math.floor(fx.add(y, y) / ONE);
  const northHx = nearestColumnInRow(wx, northHy);
  const northDy = fx.mul(fx.sub(y, positionYOfNode(northHy)), ROW_STEP);
  if (northDy === ZERO) {
    locatedAt(northHx, northHy, northHx, northHy, northHx, northHy);
    return;
  }
  const southHy = northHy + 1;
  const southHx = nearestColumnInRow(wx, southHy);
  const southDy = fx.mul(fx.sub(positionYOfNode(southHy), y), ROW_STEP);
  const northDx = Math.abs(fx.sub(wx, nodeWorldX(northHx, northHy)));
  const southDx = Math.abs(fx.sub(wx, nodeWorldX(southHx, southHy)));
  // A node's column line runs toward the row its column step skips, the other bracketing row.
  const onNorthLine = northDx < COLUMN_LINE_TOLERANCE && northDx < southDy;
  const onSouthLine = southDx < COLUMN_LINE_TOLERANCE && southDx < northDy;
  const southNearer = southDx * southDx + southDy * southDy < northDx * northDx + northDy * northDy;
  if (!onNorthLine && (onSouthLine || southNearer))
    locatedAt(southHx, southHy, northHx, northHy, southHx, southHy);
  else locatedAt(northHx, northHy, northHx, northHy, southHx, southHy);
}

/**
 * The radius of a node's core in column units, 23/128 column (12.2 px). A position inside it is nearer that
 * node than any other-row node by the triangle inequality, since it stays under half {@link ROW_EDGE}, and
 * no other-row node's column line reaches it, since it stays under a quarter column less
 * {@link COLUMN_LINE_TOLERANCE}. Both bounds are 24/128 column within 4 ulps; the 1/128 column (512 ulps)
 * left dwarfs the metric's ulp truncations.
 */
const NODE_CORE_RADIUS: Fixed = fx.div(fx.fromInt(23), fx.fromInt(128));
/** {@link NODE_CORE_RADIUS} squared in raw units, beside raw squared offsets. */
const NODE_CORE_RADIUS_SQUARED = NODE_CORE_RADIUS * NODE_CORE_RADIUS;
/** A Position `y` offset past which no position lies in a node's core: the radius over {@link ROW_STEP},
 *  rounded up to twice the radius. */
const NODE_CORE_SPAN_Y: Fixed = fx.add(NODE_CORE_RADIUS, NODE_CORE_RADIUS);

/**
 * Whether `(x, y)` lies in node `(hx, hy)`'s core ({@link NODE_CORE_RADIUS} of screen distance from its
 * centre), which proves {@link nodeOfPosition} reads that node there, so a caller holding a node nearby
 * skips locating. False proves nothing.
 */
export function insideNodeCore(x: Fixed, y: Fixed, hx: number, hy: number): boolean {
  const dwx = fx.sub(worldX(x, y), nodeWorldX(hx, hy));
  const dy = fx.sub(y, positionYOfNode(hy));
  if (Math.abs(dwx) >= NODE_CORE_RADIUS || Math.abs(dy) >= NODE_CORE_SPAN_Y) return false;
  const dsy = fx.mul(dy, ROW_STEP);
  return dwx * dwx + dsy * dsy < NODE_CORE_RADIUS_SQUARED;
}

/** Write a located node and the nodes beside its position into {@link located}. */
function locatedAt(
  hx: number,
  hy: number,
  northHx: number,
  northHy: number,
  southHx: number,
  southHy: number,
): void {
  located.hx = hx;
  located.hy = hy;
  located.northHx = northHx;
  located.northHy = northHy;
  located.southHx = southHx;
  located.southHy = southHy;
}

/** The column of node row `hy`'s node nearest world column `wx`, the west one on a tie. Negative ones
 *  included: an off-map transient keeps its row and column. */
function nearestColumnInRow(wx: Fixed, hy: number): number {
  const shifted = fx.sub(wx, oddRowShift(hy));
  // `ceil(c - 1/2)` over whole ulps, floored so a column just west of 0 reads 0 and not -0.
  return Math.floor((fx.add(shifted, shifted) + HALF_ONE - ULP) / ONE);
}

/**
 * The fixed-point Position of a half-cell node's centre: row `hy/2`, and `x` the node's world column
 * ({@link nodeWorldX}) with that row's stagger shift removed, which the projection re-adds. Exact,
 * because ONE divides by 4 and the stagger at a half-integer row is exactly a quarter.
 */
export function positionOfNode(hx: number, hy: number): { x: Fixed; y: Fixed } {
  return { x: positionXOfNode(hx, hy), y: positionYOfNode(hy) };
}

/** {@link positionOfNode}'s `x` alone, so a loop building its own records allocates no point. */
export function positionXOfNode(hx: number, hy: number): Fixed {
  return positionXOfWorld(nodeWorldX(hx, hy), positionYOfNode(hy));
}

/** Node `(hx, hy)`'s world column in column units: `hx/2`, plus a quarter on an odd row. */
export function nodeWorldX(hx: number, hy: number): Fixed {
  // Half a unit per node column: `fx.div(fx.fromInt(hx), TWO)` exactly, without the division.
  return fx.add(fx.mulInt(HALF_ONE, hx), oddRowShift(hy));
}

/** The eastward shift of node row `hy`: a quarter column on an odd row, none on an even one. */
function oddRowShift(hy: number): Fixed {
  return (hy & 1) === 0 ? ZERO : QUARTER_COLUMN;
}

/** {@link positionOfNode}'s `y` alone. */
export function positionYOfNode(hy: number): Fixed {
  // Half a unit per node row: `fx.div(fx.fromInt(hy), TWO)` exactly, without the division.
  return fx.mulInt(HALF_ONE, hy);
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
 * The cell any lattice node `(hx, hy)` belongs to, the original's own node-to-cell rule:
 * the row halves, and the column halves after a nudge that depends on the node row's place in the
 * four-row cycle - one right on the between row below an even cell row, one left on an odd cell row's
 * anchor row, none otherwise. On a centre node it agrees with {@link cellOfAnchorNode}; between centres it
 * decides the tie the way the original did, which is what a ground lookup under a landing node needs.
 */
export function cellOfNode(hx: number, hy: number): { readonly cx: number; readonly cy: number } {
  return { cx: cellXOfNode(hx, hy), cy: cellYOfNode(hy) };
}

/** {@link cellOfNode}'s `cx` alone, so a per-node loop allocates no cell object. */
export function cellXOfNode(hx: number, hy: number): number {
  const phase = hy & 3;
  const nudge = phase === 1 ? 1 : phase === 2 ? -1 : 0;
  return (hx + nudge) >> 1;
}

/** {@link cellOfNode}'s `cy` alone. */
export function cellYOfNode(hy: number): number {
  return hy >> 1;
}

/**
 * Whether two nodes are the same or neighbouring lattice points (Chebyshev distance at most 1).
 * Observation: a paired interaction in the original leaves no free node between the two participants.
 */
export function nodesAdjacent(a: HalfCellNode, b: HalfCellNode): boolean {
  return Math.abs(a.hx - b.hx) <= 1 && Math.abs(a.hy - b.hy) <= 1;
}

/** Even-row-frame offsets of a node's six lattice neighbours: E, W and the four in the adjacent rows,
 *  which the odd-row parity shift (`footprintCellDx`) places for an odd-row node. */
export const HEX_NEIGHBOUR_OFFSETS: readonly FootprintCell[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
];

/** The six nearest lattice nodes of `(hx, hy)`, a landscape point's ring under the half-node stagger of
 *  odd rows (docs/formats/MAPDAT.md) and the nodes the pathfinder's single edges reach; unclamped, and
 *  without the ground edge gate (`nav/terrain/edges.ts`). */
export function hexNeighboursOf(hx: number, hy: number): HalfCellNode[] {
  return HEX_NEIGHBOUR_OFFSETS.map((c) => ({ hx: hx + footprintCellDx(hy, c), hy: hy + c.dy }));
}

/**
 * The map-point distance a script's `range` parameter and every guidepost range are measured in: one
 * step per row, with a walk across rows covering one column per two rows for free. Over an odd row span
 * one further column step is free, in the direction the destination row's parity picks: the odd row's
 * quarter-column shift, so the region a range selects is a hexagon symmetric about its centre.
 *
 * The six nodes this makes adjacent are the edges a unit walks (`nav/terrain/edges.ts`), each counted
 * as one step here where the walk prices them by world length. Original behavior: the
 * hexagon-direction distance every range test uses (`docs/formats/MISSIONS.md`, "Tokens and parameter
 * kinds").
 */
export function hexDistance(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

/** {@link hexDistance} over bare coordinates, for a scan that must not allocate a node per test. */
export function hexDistanceBetween(ahx: number, ahy: number, bhx: number, bhy: number): number {
  const dx = bhx - ahx;
  const rows = Math.abs(bhy - ahy);
  // Integer coordinates: `& 1` is the row parity for negative rows too, and `>> 1` floors the
  // non-negative span, without `%`'s and `Math.floor`'s double paths.
  // The free column step of an odd row span lies east of an even destination row and west of an odd
  // one. Branch-free, as neither parity nor heading is predictable in a range scan: `toward` is `dx`
  // seen from the destination's free side, and the shift reads 1 exactly when it is positive.
  const toward = dx * (1 - ((bhy & 1) << 1));
  const columns = Math.abs(dx) - (rows & 1 & (-toward >>> 31));
  return rows + Math.max(0, columns - (rows >> 1));
}

/** Manhattan distance between two lattice nodes in half-cell nodes, not the anisotropic world metric. */
export function nodeManhattan(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** The six map-point headings, numbered as the original numbers them (its walk directions' first six). */
export const HEX_HEADING = { E: 0, SE: 1, SW: 2, W: 3, NW: 4, NE: 5 } as const;
export type HexHeading = (typeof HEX_HEADING)[keyof typeof HEX_HEADING];
/** The number of {@link HEX_HEADING}s. */
export const HEX_HEADING_COUNT = 6;

/**
 * The map-point heading from `(ahx, ahy)` toward `(bhx, bhy)`: the 60-degree sector holding the bearing
 * on the map-point grid, odd rows shifted half a node east as {@link hexDistance} counts them, with E
 * spanning -30..30 degrees. Original behavior, straight north reading NE, straight south SW and the same
 * point E. Approximation: the original first truncates the bearing to whole degrees, which moves its
 * northern sector edges by under a degree; the edges here are exact.
 */
export function hexHeadingBetween(ahx: number, ahy: number, bhx: number, bhy: number): HexHeading {
  // Doubled coordinates keep the half-node row shift integral.
  const dx = 2 * bhx + (bhy & 1) - (2 * ahx + (ahy & 1));
  const dy = 2 * (bhy - ahy);
  if (dy === 0) return dx < 0 ? HEX_HEADING.W : HEX_HEADING.E;
  // Within 30 degrees of the east-west axis: tan^2(30) = 1/3. No nonzero integer pair sits on the edge.
  if (3 * dy * dy < dx * dx) return dx > 0 ? HEX_HEADING.E : HEX_HEADING.W;
  if (dy > 0) return dx > 0 ? HEX_HEADING.SE : HEX_HEADING.SW;
  return dx >= 0 ? HEX_HEADING.NE : HEX_HEADING.NW;
}

/** The first column of row `hy` within `range` map points of `centre`, {@link hexDistance} inverted
 *  for one row; meaningful only for a row at most `range` rows away. */
export function rowReachLeft(centre: HalfCellNode, hy: number, range: number): number {
  const rows = Math.abs(hy - centre.hy);
  return centre.hx - rowReach(rows, range) - (rows % 2 !== 0 && hy % 2 !== 0 ? 1 : 0);
}

/** The last column of row `hy` within `range` map points of `centre`; see {@link rowReachLeft}. */
export function rowReachRight(centre: HalfCellNode, hy: number, range: number): number {
  const rows = Math.abs(hy - centre.hy);
  return centre.hx + rowReach(rows, range) + (rows % 2 !== 0 && hy % 2 === 0 ? 1 : 0);
}

function rowReach(rows: number, range: number): number {
  return range - rows + Math.floor(rows / 2);
}

/** The nearest and farthest {@link hexDistance} from `centre` to a node of the `width` x `height`
 *  lattice: the distance grows with the column and the row offset alike, so the clamped centre is
 *  the nearest node and a corner the farthest. */
export function latticeDistanceBounds(
  centre: HalfCellNode,
  width: number,
  height: number,
): { readonly nearest: number; readonly farthest: number } {
  const clamp = (value: number, size: number): number => Math.min(Math.max(value, 0), size - 1);
  const nearest = hexDistanceBetween(clamp(centre.hx, width), clamp(centre.hy, height), centre.hx, centre.hy);
  let farthest = 0;
  for (const hx of [0, width - 1]) {
    for (const hy of [0, height - 1]) {
      farthest = Math.max(farthest, hexDistanceBetween(hx, hy, centre.hx, centre.hy));
    }
  }
  return { nearest, farthest };
}

/** Visit the nodes of the `width` x `height` lattice exactly `radius` map points from `centre`, row by
 *  row and ascending within a row, until `visit` answers false; answers whether the walk finished. */
export function forEachRingNode(
  centre: HalfCellNode,
  radius: number,
  width: number,
  height: number,
  visit: (hx: number, hy: number) => boolean,
): boolean {
  const last = Math.min(height - 1, centre.hy + radius);
  for (let hy = Math.max(0, centre.hy - radius); hy <= last; hy++) {
    const left = Math.max(0, rowReachLeft(centre, hy, radius));
    const right = Math.min(width - 1, rowReachRight(centre, hy, radius));
    // A row nearer than the ring also crosses the disc one ring in, which splits the ring's run in two.
    const crossesInner = Math.abs(hy - centre.hy) < radius;
    const innerLeft = crossesInner ? rowReachLeft(centre, hy, radius - 1) : right + 1;
    const innerRight = crossesInner ? rowReachRight(centre, hy, radius - 1) : right;
    for (let hx = left; hx <= Math.min(right, innerLeft - 1); hx++) if (!visit(hx, hy)) return false;
    for (let hx = Math.max(left, innerRight + 1); hx <= right; hx++) if (!visit(hx, hy)) return false;
  }
  return true;
}

/** The six map-point directions in turning order; a diagonal lands on the row's parity the way
 *  {@link hexDistance} counts it, so every step is one map point. */
export type HexDirection = 'east' | 'southEast' | 'southWest' | 'west' | 'northWest' | 'northEast';
/** The directions in turning order, so a facing index and a direction offset add modulo six. */
export const HEX_DIRECTIONS: readonly HexDirection[] = [
  'east',
  'southEast',
  'southWest',
  'west',
  'northWest',
  'northEast',
];

/** The map point one step from `from` in `direction`. */
export function stepHex(from: HalfCellNode, direction: HexDirection): HalfCellNode {
  const { hx, hy } = from;
  switch (direction) {
    case 'east':
      return { hx: hx + 1, hy };
    case 'west':
      return { hx: hx - 1, hy };
    case 'southEast':
      return { hx: (hy + 1) % 2 === 0 ? hx + 1 : hx, hy: hy + 1 };
    case 'southWest':
      return { hx: (hy + 1) % 2 === 0 ? hx : hx - 1, hy: hy + 1 };
    case 'northEast':
      return { hx: (hy - 1) % 2 === 0 ? hx + 1 : hx, hy: hy - 1 };
    case 'northWest':
      return { hx: (hy - 1) % 2 === 0 ? hx : hx - 1, hy: hy - 1 };
  }
}

/**
 * The ring walk of {@link hexagonRing} in doubled columns (`2 * hx + (hy & 1)`, so every step is integral):
 * each side's first point, in multiples of the radius from the centre, and each side's step. The walk
 * starts `radius` steps north-west of the centre and turns east, south-east, south-west, west, north-west,
 * north-east, the order of {@link HEX_DIRECTIONS}.
 */
const RING_CORNER_DOUBLED_DX: readonly number[] = [-1, 1, 2, 1, -1, -2];
const RING_CORNER_DY: readonly number[] = [-1, -1, 0, 1, 1, 0];
const RING_STEP_DOUBLED_DX: readonly number[] = [2, 1, -1, -2, -1, 1];
const RING_STEP_DY: readonly number[] = [0, 1, 1, 0, -1, -1];
const RING_SIDE_COUNT = HEX_DIRECTIONS.length;

/** How many points {@link hexagonRing} yields for `radius`: the centre alone for a radius of 0 or less. */
export function hexRingLength(radius: number): number {
  return radius <= 0 ? 1 : RING_SIDE_COUNT * radius;
}

/** The row of the `index`th point of {@link hexagonRing} around `(hx, hy)`, `index` below
 *  {@link hexRingLength}; with {@link hexRingHx}, a ring walk that allocates nothing. */
export function hexRingHy(hy: number, radius: number, index: number): number {
  if (radius <= 0) return hy;
  const side = Math.floor(index / radius);
  return hy + (RING_CORNER_DY[side] ?? 0) * radius + (RING_STEP_DY[side] ?? 0) * (index - side * radius);
}

/** The column of the `index`th point of {@link hexagonRing} around `(hx, hy)`; see {@link hexRingHy}. */
export function hexRingHx(hx: number, hy: number, radius: number, index: number): number {
  if (radius <= 0) return hx;
  const side = Math.floor(index / radius);
  const doubled =
    2 * hx +
    (hy & 1) +
    (RING_CORNER_DOUBLED_DX[side] ?? 0) * radius +
    (RING_STEP_DOUBLED_DX[side] ?? 0) * (index - side * radius);
  return (doubled - (hexRingHy(hy, radius, index) & 1)) / 2;
}

/**
 * The map points at hexagon distance `radius` from `centre`, in the original's ring order: a walk
 * that starts `radius` steps north-west of the centre and turns east, south-east, south-west, west,
 * north-west, north-east, `radius` steps a side (reading). `step` counts from 0 on every side. A
 * radius of 0 yields the centre alone. A hot loop walks {@link hexRingHx}/{@link hexRingHy} instead.
 */
export function* hexagonRing(
  centre: HalfCellNode,
  radius: number,
): Generator<{ readonly point: HalfCellNode; readonly step: number }> {
  if (radius <= 0) {
    yield { point: centre, step: 0 };
    return;
  }
  const { hx, hy } = centre;
  for (let i = 0; i < hexRingLength(radius); i++) {
    const point = { hx: hexRingHx(hx, hy, radius, i), hy: hexRingHy(hy, radius, i) };
    yield { point, step: i % radius };
  }
}
