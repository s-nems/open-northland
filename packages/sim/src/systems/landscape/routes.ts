import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Stranded,
  UnreachableGoals,
  type Waypoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { dropPath } from '../movement/nav-state.js';

/** A script changes topology immediately; existing paths and remembered failures must not outlive it. */
export function invalidateLandscapeRoutes(world: World, terrain: TerrainGraph): void {
  forgetRouteFailures(world);
  // A diagonal can close through its midpoint flanks without either endpoint becoming blocked.
  // Requeue active routes through the normal search budget, including travellers already mid-leg.
  for (const e of [...world.query(PathFollow, Position)]) requeueRoute(world, terrain, e);
}

/** Drop every remembered unreachable goal and stranded park, so a way a script opened is tried again
 *  at once rather than when the memo runs out. */
export function forgetRouteFailures(world: World): void {
  for (const e of [...world.query(Stranded)]) world.remove(e, Stranded);
  for (const e of [...world.query(UnreachableGoals)]) world.remove(e, UnreachableGoals);
}

/** Whether any walker follows a route, which a closing could cut. */
export function anyRouteFollowed(world: World): boolean {
  return world.query(PathFollow, PathRoute, Position).next().done !== true;
}

/**
 * A walker whose remaining route crosses one of `cells` stops short of them and searches again, so a gate
 * shut or a wall finished in front of it is never walked through. Costs one bounds test per walker, and
 * the remaining stops of the routes whose bounds take in a closed cell.
 */
export function invalidateRoutesThrough(
  world: World,
  terrain: TerrainGraph,
  cells: ReadonlySet<NodeId>,
): void {
  if (cells.size === 0) return;
  const closed = nodeBoundsOf(terrain, cells);
  const crossing: { e: Entity; stop: number }[] = [];
  for (const e of world.query(PathFollow, PathRoute, Position)) {
    const waypoints = world.get(e, PathRoute).waypoints;
    if (!boundsMeet(routeBoundsOf(terrain, waypoints), closed)) continue;
    const stop = firstStopInto(terrain, waypoints, world.get(e, PathFollow).index, cells);
    if (stop !== null) crossing.push({ e, stop });
  }
  for (const { e, stop } of crossing) haltBefore(world, terrain, e, stop);
}

interface NodeBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Each route's node bounds, which also hold its diagonals' midpoint flanks. Keyed on the stop array,
 *  which a delivery or a cut replaces rather than edits. Derived, never hashed. */
const routeBounds = new WeakMap<readonly Waypoint[], NodeBounds>();

function routeBoundsOf(terrain: TerrainGraph, waypoints: readonly Waypoint[]): NodeBounds {
  let bounds = routeBounds.get(waypoints);
  if (bounds === undefined) {
    bounds = nodeBoundsOf(
      terrain,
      waypoints.map((stop) => stop.node),
    );
    routeBounds.set(waypoints, bounds);
  }
  return bounds;
}

function nodeBoundsOf(terrain: TerrainGraph, nodes: Iterable<NodeId>): NodeBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function boundsMeet(a: NodeBounds, b: NodeBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** The first stop from `from` on that stands in `cells`, or that is the midpoint of a diagonal slipping
 *  past one: a diagonal keeps only one of its two midpoint flanks as its stop. */
function firstStopInto(
  terrain: TerrainGraph,
  waypoints: readonly Waypoint[],
  from: number,
  cells: ReadonlySet<NodeId>,
): number | null {
  // A midpoint is always followed by a node, which then needs no midpoint test.
  let afterMidpoint = false;
  for (let at = from; at < waypoints.length; at++) {
    const stop = waypoints[at];
    if (stop === undefined) continue;
    if (cells.has(stop.node)) return at;
    if (afterMidpoint) {
      afterMidpoint = false;
      continue;
    }
    const flanks = diagonalFlanks(terrain, waypoints, at);
    if (flanks === null) continue;
    afterMidpoint = true;
    if (cells.has(flanks[0]) || cells.has(flanks[1])) return at;
  }
  return null;
}

/** The two midpoint flanks when stop `at` is the middle of a diagonal edge, else null. The node between
 *  two diagonals in one direction lines up like a midpoint too, but it stands on its node's centre. */
function diagonalFlanks(
  terrain: TerrainGraph,
  waypoints: readonly Waypoint[],
  at: number,
): readonly [NodeId, NodeId] | null {
  const before = waypoints[at - 1];
  const middle = waypoints[at];
  const after = waypoints[at + 1];
  if (before === undefined || middle === undefined || after === undefined) return null;
  const ax = terrain.xOf(before.node);
  const ay = terrain.yOf(before.node);
  const cx = terrain.xOf(after.node);
  const cy = terrain.yOf(after.node);
  const my = terrain.yOf(middle.node);
  if (ax === cx || Math.abs(cy - ay) !== DIAGONAL_ROW_SPAN || my * 2 !== ay + cy) return null;
  if (!isEdgeMidpoint(terrain, middle)) return null;
  return [terrain.nodeAt(ax, my), terrain.nodeAt(cx, my)];
}

/** A diagonal's half-rows: its end nodes lie two half-rows apart. */
const DIAGONAL_ROW_SPAN = 2;

/** Whether `stop` is a diagonal's midpoint, the one kind of stop that sits off its node's centre. */
function isEdgeMidpoint(terrain: TerrainGraph, stop: Waypoint): boolean {
  const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
  return centre.x !== stop.x || centre.y !== stop.y;
}

/**
 * Cut the route before stop `stop` so the walker parks on the last free node centre, or turns back to the
 * node it left when the leg under way runs into the closed cells, then search again from where it stands.
 */
function haltBefore(world: World, terrain: TerrainGraph, e: Entity, stop: number): void {
  const route = world.mut(e, PathFollow);
  const path = world.mut(e, PathRoute);
  const waypoints = path.waypoints;
  let end = stop;
  // A diagonal's midpoint is the middle of an edge, not a node centre to park on, even the one it heads to.
  while (end - 1 >= route.index && diagonalFlanks(terrain, waypoints, end - 1) !== null) end -= 1;
  if (end > route.index) {
    path.waypoints = waypoints.slice(0, end);
  } else {
    const back = waypoints[route.index - 1];
    const beforeBack = waypoints[route.index - 2];
    if (back === undefined) {
      dropPath(world, e);
    } else {
      // Past a midpoint, the way back runs through it to the node the diagonal left.
      path.waypoints =
        beforeBack !== undefined && isEdgeMidpoint(terrain, back) ? [back, beforeBack] : [back];
      route.index = 0;
      route.legTicks = 0;
      route.legCost = 0;
      route.legPace = undefined;
      route.departureCharged = undefined;
    }
  }
  requestFromHere(world, terrain, e);
}

/** Drop the followed route and, for a walker with a goal, request a fresh one from where it stands. */
function requeueRoute(world: World, terrain: TerrainGraph, e: Entity): void {
  dropPath(world, e);
  requestFromHere(world, terrain, e);
}

function requestFromHere(world: World, terrain: TerrainGraph, e: Entity): void {
  world.remove(e, PathRequest);
  const goal = world.tryGet(e, MoveGoal)?.cell;
  if (goal === undefined) return;
  const p = world.get(e, Position);
  const start = nodeOfPosition(p.x, p.y);
  world.add(e, PathRequest, { start: terrain.nodeAtClamped(start.hx, start.hy), goal, failed: false });
}
