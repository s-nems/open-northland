import { Garrison, Position, Resting } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { atOrWalk } from './atomics/start.js';

/**
 * Walk `e` to `door`, then step it inside `building` on arrival and run `then`: the tail of every errand
 * that ends indoors. The marker means "inside, and the render must not draw it", so it holds only while
 * some owner keeps the settler in - a family duty, a livestock visit, a manned post, or an alarm - while a
 * plain errand outlasts a re-plan by running an atomic and steps back out when it ends.
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
  standDownFromPost(world, e);
  world.remove(e, Resting);
}

/**
 * Take the post inside `building`: stand on its own tile and remember the doorstep to come back to. This is
 * the extra move a garrison makes, so its shot leaves the tower instead of its doorstep.
 *
 * This and `standDownFromPost` are the only writes to a settler's `Position` outside the movement system,
 * and they land it on a building's own walk-blocked node, so a settler-position-keyed spatial index would
 * have to account for them.
 */
export function takePost(world: World, e: Entity, building: Entity): void {
  const at = world.tryGet(building, Position);
  const from = world.tryMut(e, Position);
  if (at === undefined || from === undefined) return;
  world.add(e, Garrison, { post: building, returnTo: { x: from.x, y: from.y } });
  from.x = at.x;
  from.y = at.y;
}

/**
 * Leaving the building ends any garrison duty. The doorstep is restored only while the settler still stands
 * where `takePost` put it: another drive can march a garrison off its tower without passing through here,
 * and restoring that settler's doorstep would teleport it across the map.
 */
function standDownFromPost(world: World, e: Entity): void {
  const held = world.tryGet(e, Garrison);
  if (held === undefined) return;
  const pos = world.tryMut(e, Position);
  const at = world.tryGet(held.post, Position);
  if (pos !== undefined && at !== undefined && pos.x === at.x && pos.y === at.y) {
    pos.x = held.returnTo.x;
    pos.y = held.returnTo.y;
  }
  world.remove(e, Garrison);
}
