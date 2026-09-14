/**
 * The single seam between fixed-point positions (fractional visual-tile coordinates, stagger applied by
 * the projection) and the navigation lattice's integer half-cell nodes. The lattice is rectangular in
 * world space and carries no stagger of its own. Every integer grid coordinate inside the sim is a
 * half-cell coordinate.
 */
import { type FootprintCell, footprintCellDx } from '@open-northland/data';
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

/** {@link nodeOfPosition}'s `hx` alone, so a per-tick loop allocates no node object per call. */
export function nodeHxOfPosition(x: Fixed, y: Fixed): number {
  return fx.toInt(fx.mul(worldX(x, y), TWO));
}

/** {@link nodeOfPosition}'s `hy` alone. */
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

/** Even-row-frame offsets of a node's six lattice neighbours: E, W and the four in the adjacent rows,
 *  which the odd-row parity shift (`footprintCellDx`) places for an odd-row node. */
const HEX_NEIGHBOUR_CELLS: readonly FootprintCell[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
];

/** The six nearest lattice nodes of `(hx, hy)`, a landscape point's ring under the half-node stagger of
 *  odd rows (docs/formats/MAPDAT.md); unclamped, and not the pathfinder's 8-step relation. */
export function hexNeighboursOf(hx: number, hy: number): HalfCellNode[] {
  return HEX_NEIGHBOUR_CELLS.map((c) => ({ hx: hx + footprintCellDx(hy, c), hy: hy + c.dy }));
}

/**
 * The map-point distance a script's `range` parameter and every guidepost range are measured in: one
 * step per row, with a diagonal walk covering one column per two rows for free. Over an odd row span
 * one further column step is free, in the direction the destination row's parity picks, so the region
 * a range selects leans to one side instead of being symmetric about its centre.
 *
 * The six nodes this makes adjacent are not the eight a unit walks (`nav/terrain/edges.ts`), and the
 * lean is not this lattice's geometry, which carries no stagger: both belong to the original's own
 * map-point grid. Byte evidence: the engine's hexagon-direction distance (macOS symbols
 * `VE_HexagonDirection_GetDistance`, the original an original routine), which every range test calls
 * (`docs/formats/MISSIONS.md`, "Tokens and parameter kinds").
 */
export function hexDistance(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

/** {@link hexDistance} over bare coordinates, for a scan that must not allocate a node per test. */
export function hexDistanceBetween(ahx: number, ahy: number, bhx: number, bhy: number): number {
  const dx = bhx - ahx;
  const rows = Math.abs(bhy - ahy);
  let columns = Math.abs(dx);
  if (rows % 2 !== 0 && (bhy % 2 === 0 ? dx > 0 : dx < 0)) columns--;
  return rows + Math.max(0, columns - Math.floor(rows / 2));
}

/** The six map-point directions in turning order; a diagonal lands on the row's parity the way
 *  {@link hexDistance} counts it, so every step is one map point. */
type HexDirection = 'east' | 'southEast' | 'southWest' | 'west' | 'northWest' | 'northEast';
const RING_SIDES: readonly HexDirection[] = [
  'east',
  'southEast',
  'southWest',
  'west',
  'northWest',
  'northEast',
];
const RING_START: HexDirection = 'northWest';

function stepHex(from: HalfCellNode, direction: HexDirection): HalfCellNode {
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
 * The map points at hexagon distance `radius` from `centre`, in the original's ring order: a walk
 * that starts `radius` steps north-west of the centre and turns east, south-east, south-west, west,
 * north-west, north-east, `radius` steps a side (reading). `step` counts from 0 on every side. A
 * radius of 0 yields the centre alone.
 */
export function* hexagonRing(
  centre: HalfCellNode,
  radius: number,
): Generator<{ readonly point: HalfCellNode; readonly step: number }> {
  if (radius <= 0) {
    yield { point: centre, step: 0 };
    return;
  }
  let at = centre;
  for (let i = 0; i < radius; i++) at = stepHex(at, RING_START);
  for (const side of RING_SIDES) {
    for (let step = 0; step < radius; step++) {
      yield { point: at, step };
      at = stepHex(at, side);
    }
  }
}
