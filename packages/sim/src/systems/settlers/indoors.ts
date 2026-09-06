import {
  FamilyDuty,
  Garrison,
  LivestockVisit,
  Position,
  Residence,
  Resting,
  Sheltering,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { atOrWalk } from './atomics/start.js';

/**
 * Walk `e` to `door`, then step it inside `building` on arrival and run `then`. The `Resting` marker it
 * sets means "inside", which the render draws only through the workplace's own craft choreography; a
 * re-plan sheds it unless a family duty, a livestock visit, a manned post, or an alarm still holds the
 * settler in.
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

/**
 * Whether a system outside the drive ladder is holding `e` indoors, so a re-plan leaves its `Resting`
 * marker alone: shedding it would pop the settler out of cover and back in every tick.
 */
export function heldIndoors(world: World, e: Entity): boolean {
  return (
    world.has(e, FamilyDuty) ||
    world.has(e, LivestockVisit) ||
    world.has(e, Garrison) ||
    world.has(e, Sheltering)
  );
}

/** Whether `e` is indoors in its own house - the state the at-home need rules key on. */
export function isInsideOwnHome(world: World, e: Entity): boolean {
  const home = world.tryGet(e, Residence)?.home;
  return home !== undefined && isInside(world, e, home);
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
