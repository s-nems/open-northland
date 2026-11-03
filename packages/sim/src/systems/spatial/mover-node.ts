import { PathFollow, PathRoute, type Waypoint } from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, insideNodeCore, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { worldX } from '../../nav/world-metric.js';

/** The Position `y` span of a column step: two node rows, one visual row. */
const COLUMN_STEP_SPAN: Fixed = ONE;

/** The stops {@link readColumnStep} found, valid until its next call. */
const step: { from: Waypoint | null; to: Waypoint | null } = { from: null, to: null };

/** The start and destination stops of the column step `e` walks now, two rows straight up or down
 *  (`pathfinding/straight-steps.ts`), or undefined on any other leg. */
export function liveColumnStep(world: World, e: Entity): readonly [Waypoint, Waypoint] | undefined {
  const from = readColumnStep(world, e) ? step.from : null;
  const to = step.to;
  return from === null || to === null ? undefined : [from, to];
}

/** Whether `e` walks a column step now, its stops written into {@link step}. Read off the stops' positions,
 *  which are their nodes' centres, so it needs no terrain. */
function readColumnStep(world: World, e: Entity): boolean {
  step.from = null;
  step.to = null;
  const follow = world.tryGet(e, PathFollow);
  if (follow === undefined) return false;
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  const from = stops?.[follow.index - 1];
  const to = stops?.[follow.index];
  if (from === undefined || to === undefined) return false;
  if (Math.abs(fx.sub(to.y, from.y)) !== COLUMN_STEP_SPAN) return false;
  if (worldX(from.x, from.y) !== worldX(to.x, to.y)) return false;
  step.from = from;
  step.to = to;
  return true;
}

/** {@link moverNode}'s result, reused so a per-mover read allocates nothing. */
const read = { hx: 0, hy: 0 };

/**
 * Slots of the last position each mover's node was located at, indexed by entity id modulo their count.
 * The node is a pure function of the position, so a slot answers whenever its position matches, whoever
 * wrote it: a mover read by several indexes in one tick locates once. Authored: a power of two above a
 * late game's walkers.
 */
const NODE_MEMO_SLOTS = 1 << 14;
const NODE_MEMO_MASK = NODE_MEMO_SLOTS - 1;
const memoX = new Float64Array(NODE_MEMO_SLOTS).fill(Number.NaN);
const memoY = new Float64Array(NODE_MEMO_SLOTS);
const memoHx = new Int32Array(NODE_MEMO_SLOTS);
const memoHy = new Int32Array(NODE_MEMO_SLOTS);

/**
 * The half-cell node mover `e` at `p` occupies. On a live column step it is the step's start until the
 * skipped row and its destination past it, whatever push or helm holds the body off the step's line, so a
 * walker never reads a node it passes between. Elsewhere it is {@link nodeHxOfPosition}'s node. Original
 * behavior: a mover's node is its step's start or destination, never another node. The result is shared
 * and overwritten by the next call.
 */
export function moverNode(
  world: World,
  e: Entity,
  p: { readonly x: Fixed; readonly y: Fixed },
): Readonly<HalfCellNode> {
  return locatedMoverNode(e, p, readColumnStep(world, e));
}

/**
 * {@link moverNode} of `e` at `p`, given node `(hx, hy)` that `e` read lately: that node without locating
 * while `e` walks no column step and `p` lies in its core ({@link insideNodeCore}), as an in-node step near
 * the node's centre does. The result is shared like {@link moverNode}'s.
 */
export function moverNodeNear(
  world: World,
  e: Entity,
  p: { readonly x: Fixed; readonly y: Fixed },
  hx: number,
  hy: number,
): Readonly<HalfCellNode> {
  const onColumnStep = readColumnStep(world, e);
  if (!onColumnStep && insideNodeCore(p.x, p.y, hx, hy)) {
    read.hx = hx;
    read.hy = hy;
    return read;
  }
  return locatedMoverNode(e, p, onColumnStep);
}

/** {@link moverNode} after {@link readColumnStep}, its stops in {@link step} when `onColumnStep`. */
function locatedMoverNode(
  e: Entity,
  p: { readonly x: Fixed; readonly y: Fixed },
  onColumnStep: boolean,
): Readonly<HalfCellNode> {
  let x = p.x;
  let y = p.y;
  const from = step.from;
  const to = step.to;
  if (onColumnStep && from !== null && to !== null) {
    const stop = columnStepStopAt(from, to, p.y);
    x = stop.x;
    y = stop.y;
  }
  const slot = e & NODE_MEMO_MASK;
  if (memoX[slot] !== x || memoY[slot] !== y) {
    memoX[slot] = x;
    memoY[slot] = y;
    memoHx[slot] = nodeHxOfPosition(x, y);
    memoHy[slot] = nodeHyOfPosition(x, y);
  }
  read.hx = memoHx[slot] ?? 0;
  read.hy = memoHy[slot] ?? 0;
  return read;
}

/** The stop a column step from `from` to `to` reads at row `y`: its start until the skipped row, its
 *  destination past it. */
export function columnStepStopAt(from: Waypoint, to: Waypoint, y: Fixed): Waypoint {
  return Math.abs(fx.sub(y, to.y)) < Math.abs(fx.sub(y, from.y)) ? to : from;
}
