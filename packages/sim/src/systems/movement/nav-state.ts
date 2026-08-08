import { MoveGoal, PathFollow, PathRequest, Stranded } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/** Whether `e` has a navigation goal, a pending path request, or a path it is walking. */
export function isTravelling(world: World, e: Entity): boolean {
  return world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow);
}

/** Drop `e`'s whole navigation state: goal, pending request, followed path, and stranded-retry pacing. */
export function clearNavState(world: World, e: Entity): void {
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, Stranded);
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
