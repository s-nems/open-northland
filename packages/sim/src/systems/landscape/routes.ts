import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Stranded,
  UnreachableGoals,
  VehicleYardRefusals,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionYOfNode } from '../../nav/halfcell.js';
import { columnStepMiddles, isColumnStep } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { dropPath } from '../movement/nav-state.js';
import { type NodeBounds, nodeBoundsOf, routeBoundsOf } from '../movement/route-bounds.js';
import { routeStartCell } from '../movement/route-start.js';
import { settlerTraversal } from '../movement/traversal.js';

/** A script closes topology immediately; keep the same safe stopping path as a wall closure. */
export function invalidateLandscapeRoutes(
  world: World,
  terrain: TerrainGraph,
  closed: ReadonlySet<NodeId>,
): void {
  forgetRouteFailures(world, terrain);
  invalidateRoutesThrough(world, terrain, closed);
}

/** An opening may invalidate a pending refusal. Keep its recovery deadline until budgeted routing
 * proves the walk works; unrelated openings therefore cannot keep a genuine failure parked forever. */
export function retryFailedRoutes(world: World, terrain: TerrainGraph): void {
  const failed = [...world.query(PathRequest, Position)].filter((e) => world.get(e, PathRequest).failed);
  for (const e of failed) requestFromHere(world, terrain, e, world.get(e, PathRequest).retainRoute === true);
}

/** Drop every remembered unreachable goal, stranded park and refused vehicle yard, so a way or ground a
 *  script opened is tried again at once rather than when the memo runs out. */
export function forgetRouteFailures(world: World, terrain: TerrainGraph): void {
  retryFailedRoutes(world, terrain);
  for (const e of [...world.query(Stranded)]) world.remove(e, Stranded);
  for (const e of [...world.query(UnreachableGoals)]) world.remove(e, UnreachableGoals);
  for (const e of [...world.query(VehicleYardRefusals)]) world.remove(e, VehicleYardRefusals);
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
    const stop = firstStopInto(
      terrain,
      waypoints,
      world.get(e, PathFollow).index,
      world.get(e, Position).y,
      cells,
    );
    if (stop !== null) crossing.push({ e, stop });
  }
  for (const { e, stop } of crossing) haltBefore(world, terrain, e, stop);
}

function boundsMeet(a: NodeBounds, b: NodeBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** The first route stop whose node has closed, or that a column step reaches between two nodes one of
 *  which has closed, unless the walker at row `y` has already passed them on its live leg and only
 *  finishes the step. This build's adaptation: the original checks only the step's destination, but a
 *  column step slipping between two new wall posts would walk through the wall; the new search takes the
 *  column step again while one of the two stays open. */
function firstStopInto(
  terrain: TerrainGraph,
  waypoints: readonly Waypoint[],
  from: number,
  y: Fixed,
  cells: ReadonlySet<NodeId>,
): number | null {
  for (let at = from; at < waypoints.length; at++) {
    const stop = waypoints[at];
    if (stop === undefined) continue;
    if (cells.has(stop.node)) return at;
    const previous = waypoints[at - 1];
    if (previous === undefined || !isColumnStep(terrain, previous.node, stop.node)) continue;
    if (at === from && passedSkippedRow(terrain, previous.node, stop.node, y)) continue;
    for (const middle of columnStepMiddles(terrain, previous.node, stop.node)) {
      if (middle !== undefined && cells.has(middle)) return at;
    }
  }
  return null;
}

/** Whether row `y` lies beyond the row a column step from `from` to `to` skips, in the step's direction. */
function passedSkippedRow(terrain: TerrainGraph, from: NodeId, to: NodeId, y: Fixed): boolean {
  const fromY = terrain.yOf(from);
  const toY = terrain.yOf(to);
  const skipped = positionYOfNode((fromY + toY) / 2);
  return toY > fromY ? y > skipped : y < skipped;
}

/**
 * Cut the route before stop `stop` so the walker parks on the last free node centre, or turns back to the
 * node it left when the leg under way runs into the closed cells, then search again from where it stands.
 */
function haltBefore(world: World, terrain: TerrainGraph, e: Entity, stop: number): void {
  const route = world.mut(e, PathFollow);
  const path = world.mut(e, PathRoute);
  const waypoints = path.waypoints;
  if (stop > route.index) {
    path.waypoints = waypoints.slice(0, stop);
  } else {
    const back = waypoints[route.index - 1];
    if (back === undefined) {
      dropPath(world, e);
    } else {
      path.waypoints = [back];
      route.index = 0;
      route.legElapsed = 0;
      route.legStartedAt = undefined;
      route.legCost = 0;
      route.legPace = undefined;
      route.departureCharged = undefined;
      // A walker without a turn heading is drawn facing the stop it walks toward, now the one behind it.
      const turns = world.has(e, WalkFacing);
      route.towardX = turns ? undefined : back.x;
      route.towardY = turns ? undefined : back.y;
    }
  }
  requestFromHere(world, terrain, e, true);
}

function requestFromHere(world: World, terrain: TerrainGraph, e: Entity, retainSafePrefix: boolean): void {
  world.remove(e, PathRequest);
  const goal = world.tryGet(e, MoveGoal)?.cell;
  if (goal === undefined) return;
  const p = world.get(e, Position);
  // A closing may have turned the live leg back. Search from the end of that safe prefix,
  // not a nearby bracket which could lie on or beyond the newly closed cells.
  const safeEnd =
    retainSafePrefix && world.has(e, PathFollow) ? world.get(e, PathRoute).waypoints.at(-1)?.node : undefined;
  world.add(e, PathRequest, {
    start: safeEnd ?? routeStartCell(terrain, p.x, p.y, settlerTraversal(world, e)),
    goal,
    failed: false,
    retainRoute: safeEnd === undefined ? undefined : true,
  });
}
