import { Resting } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { atOrWalk } from './atomics/start.js';

/**
 * Walk `e` to `door`, then step it inside `building` on arrival and run `then`: the tail of every errand
 * that ends indoors. The marker means "inside, and the render must not draw it", so it holds only while
 * something keeps the settler in - the planner sheds it on every re-plan (`planner/replan.ts`) unless the
 * FamilySystem owns the settler (`FamilyDuty`), and a firing needs drive sheds it (`drives/ladder.ts`)
 * unless the settler just got into its own bed. An errand outlasts both by running an atomic (a re-plan
 * skips a busy settler) and steps back out when it ends; {@link isInside} is the read.
 */
export function enterBuilding(
  world: World,
  e: Entity,
  building: Entity,
  here: NodeId,
  door: NodeId,
  then?: () => void,
): void {
  atOrWalk(world, e, here, door, () => {
    stepIn(world, e, building);
    then?.();
  });
}

export function stepIn(world: World, e: Entity, building: Entity): void {
  world.add(e, Resting, { at: building });
}

export function isInside(world: World, e: Entity, building: Entity): boolean {
  return world.tryGet(e, Resting)?.at === building;
}

export function stepOut(world: World, e: Entity): void {
  world.remove(e, Resting);
}
