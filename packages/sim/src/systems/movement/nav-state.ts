import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Stranded,
  type Waypoint,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/** Whether `e` has a navigation goal, a pending path request, or a path it is walking. */
export function isTravelling(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
}

/** Drop `e`'s whole navigation state: goal, pending request, followed path, and stranded-retry pacing. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  dropPath(world, e);
  world.remove(e, Stranded);
}

/** Drop the path `e` walks, its {@link PathFollow} progress and {@link PathRoute} stops together. */
export function dropPath(world: World, e: Entity): void {
  world.remove(e, PathFollow);
  world.remove(e, PathRoute);
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

/** Release an intent while finishing only its live lattice step. Diagonal midpoints are not stops.
 * Returns whether movement still has a step to finish; a new intent can splice it normally. */
export function stopAtNextNode(world: World, terrain: TerrainGraph, e: Entity): boolean {
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
  const end = liveStepEnd(terrain, follow.index, stops);
  if (end === undefined) {
    dropPath(world, e);
    return false;
  }
  if (end + 1 < stops.length) world.mut(e, PathRoute).waypoints = stops.slice(0, end + 1);
  return true;
}

/** The index of the stop that ends a walker's live lattice step, from the leg toward `index` on: the first
 *  stop on its node's centre, so a diagonal's midpoint is passed over. Undefined when none is. */
export function liveStepEnd(
  terrain: TerrainGraph,
  index: number,
  stops: readonly Waypoint[],
): number | undefined {
  for (let end = index; end < stops.length; end++) {
    const stop = stops[end];
    if (stop === undefined) continue;
    const at = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
    if (stop.x === at.x && stop.y === at.y) return end;
  }
  return undefined;
}
