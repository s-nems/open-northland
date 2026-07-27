import { Resting } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

/** Whether `e` is waiting inside `house`: the {@link Resting} marker the render hides it by. */
export function isInside(world: World, e: Entity, house: Entity): boolean {
  return world.tryGet(e, Resting)?.at === house;
}

/** Step `e` back out of the house it waits in. */
export function stepOut(world: World, e: Entity): void {
  world.remove(e, Resting);
}
