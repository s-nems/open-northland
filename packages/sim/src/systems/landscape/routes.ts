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
import { nodeOfPosition } from '../../nav/halfcell.js';
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
 * shut or a wall finished in front of it is never walked through. Costs the live routes' remaining stops,
 * once per closing.
 */
export function invalidateRoutesThrough(
  world: World,
  terrain: TerrainGraph,
  cells: ReadonlySet<NodeId>,
): void {
  if (cells.size === 0) return;
  const crossing: { e: Entity; stop: number }[] = [];
  for (const e of world.query(PathFollow, PathRoute, Position)) {
    const stop = firstStopInto(
      terrain,
      world.get(e, PathRoute).waypoints,
      world.get(e, PathFollow).index,
      cells,
    );
    if (stop !== null) crossing.push({ e, stop });
  }
  for (const { e, stop } of crossing) haltBefore(world, terrain, e, stop);
}

/** The first stop from `from` on that stands in `cells`, or that is the midpoint of a diagonal slipping
 *  past one: a diagonal keeps only one of its two midpoint flanks as its stop. */
function firstStopInto(
  terrain: TerrainGraph,
  waypoints: readonly Waypoint[],
  from: number,
  cells: ReadonlySet<NodeId>,
): number | null {
  for (let at = from; at < waypoints.length; at++) {
    const stop = waypoints[at];
    if (stop === undefined) continue;
    if (cells.has(stop.node)) return at;
    const flanks = diagonalFlanks(terrain, waypoints, at);
    if (flanks !== null && (cells.has(flanks[0]) || cells.has(flanks[1]))) return at;
  }
  return null;
}

/** The two midpoint flanks when stop `at` is the middle of a diagonal edge, else null. */
function diagonalFlanks(
  terrain: TerrainGraph,
  waypoints: readonly Waypoint[],
  at: number,
): readonly [NodeId, NodeId] | null {
  const before = waypoints[at - 1];
  const middle = waypoints[at];
  const after = waypoints[at + 1];
  if (before === undefined || middle === undefined || after === undefined) return null;
  const a = terrain.coordsOf(before.node);
  const m = terrain.coordsOf(middle.node);
  const c = terrain.coordsOf(after.node);
  if (a.x === c.x || Math.abs(c.y - a.y) !== 2 || m.y * 2 !== a.y + c.y) return null;
  return [terrain.nodeAt(a.x, m.y), terrain.nodeAt(c.x, m.y)];
}

/**
 * Cut the route before stop `stop` so the walker parks on the last free node centre, or turns back to the
 * stop it left when the leg under way runs into the closed cells, then search again from where it stands.
 */
function haltBefore(world: World, terrain: TerrainGraph, e: Entity, stop: number): void {
  const route = world.mut(e, PathFollow);
  const path = world.mut(e, PathRoute);
  let end = stop;
  // A diagonal's midpoint is the middle of an edge, not a node centre to park on.
  while (end - 1 > route.index && diagonalFlanks(terrain, path.waypoints, end - 1) !== null) end -= 1;
  if (end > route.index) {
    path.waypoints = path.waypoints.slice(0, end);
  } else {
    const back = path.waypoints[route.index - 1];
    if (back === undefined) {
      dropPath(world, e);
    } else {
      path.waypoints = [back];
      route.index = 0;
      route.legTicks = 0;
      route.legCost = 0;
      delete route.legPace;
      delete route.departureCharged;
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
