import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  StandIn,
  Stranded,
  settleWalkWear,
  WalkFacing,
  type Waypoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { beginWalkTurn } from './turning.js';

/** Whether `e` has a navigation goal, a pending path request, or a path it is walking. */
export function isTravelling(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
}

/** Whether `e` stands on a node's exact centre. A path follower snaps onto each waypoint before advancing
 *  its index, so a walker is on-lattice for the tick that ends any leg. */
export function onNodeCentre(world: World, e: Entity): boolean {
  const p = world.get(e, Position);
  const centre = positionOfNode(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
  return p.x === centre.x && p.y === centre.y;
}

/** Drop `e`'s whole navigation state: goal, pending request, followed path, and stranded-retry pacing. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  dropPath(world, e);
  world.remove(e, Stranded);
  world.remove(e, StandIn);
}

/** Drop the path `e` walks, its {@link PathFollow} progress and {@link PathRoute} stops together, the
 *  boots wear the walk carried landing in the equipment. */
export function dropPath(world: World, e: Entity): void {
  settleWalkWear(world, e);
  world.remove(e, PathFollow);
  world.remove(e, PathRoute);
}

/** Restart the leg `e` walks from where it stands, as installing the same route afresh would: the step is
 *  re-timed and charged again, and the walker turns toward the stop it walks to. */
export function restartLeg(world: World, e: Entity): void {
  const index = world.tryGet(e, PathFollow)?.index;
  const target = index === undefined ? undefined : world.tryGet(e, PathRoute)?.waypoints[index];
  const position = world.tryGet(e, Position);
  if (target === undefined || position === undefined) return;
  const follow = world.mutUnseen(e, PathFollow);
  follow.legElapsed = 0;
  follow.legStartedAt = undefined;
  follow.legCost = 0;
  follow.legPace = undefined;
  follow.departureCharged = undefined;
  if (world.has(e, WalkFacing)) beginWalkTurn(world, e, position, target);
}

/** Re-aim `e`'s live route at `dest`. PathFollow survives so the routing splice carries the gait through
 *  the turn; clearing it would reset the gait to zero on every re-aim. An unchanged goal is left alone so
 *  a same-dest request keeps its routing-queue slot, and Stranded is untouched because chasing and fleeing
 *  units are exempt from the planner's parking. */
export function redirectRoute(world: World, e: Entity, dest: NodeId): void {
  if (world.tryGet(e, MoveGoal)?.cell === dest) return;
  world.remove(e, PathRequest);
  world.add(e, MoveGoal, { cell: dest });
}

/** Release an intent while finishing only its live lattice step.
 * Returns whether movement still has a step to finish; a new intent can splice it normally. */
export function stopAtNextNode(world: World, e: Entity): boolean {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  const follow = world.tryGet(e, PathFollow);
  const stops = world.tryGet(e, PathRoute)?.waypoints;
  const p = world.tryGet(e, Position);
  if (follow === undefined || stops === undefined || p === undefined) {
    dropPath(world, e);
    return false;
  }
  const here = nodeOfPosition(p.x, p.y);
  const centre = positionOfNode(here.hx, here.hy);
  if (p.x === centre.x && p.y === centre.y) {
    dropPath(world, e);
    return false;
  }
  const end = liveStepEnd(follow.index, stops);
  if (end === undefined) {
    dropPath(world, e);
    return false;
  }
  if (end + 1 < stops.length) world.mut(e, PathRoute).waypoints = stops.slice(0, end + 1);
  return true;
}

/** The index of the stop that ends a walker's live lattice step, the one the leg toward `index` heads
 *  for: every stop is a node centre. Undefined past the route's end. */
export function liveStepEnd(index: number, stops: readonly Waypoint[]): number | undefined {
  return index < stops.length ? index : undefined;
}
