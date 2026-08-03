import { Garrison, Position, Resting } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { atOrWalk } from './atomics/start.js';

/**
 * Walk `e` to `door`, then step it inside `building` on arrival and run `then`: the tail of every errand
 * that ends indoors. The marker means "inside, and the render must not draw it", so it holds only while
 * something keeps the settler in - the planner sheds it on every re-plan (`planner/replan.ts`) unless the
 * FamilySystem owns the settler (`FamilyDuty`), a feed batch owns the visiting animal
 * (`LivestockVisit` - `livestock/processing.ts` releases it), the settler is manning a post
 * ({@link takePost}), or an alarm holds it in cover (`Sheltering` - the DefenceSystem owns that exit), and
 * a firing needs drive sheds it (`drives/ladder.ts`) unless the settler just bedded down indoors. An
 * errand outlasts both by running an atomic (a re-plan skips a busy settler) and steps back out when it
 * ends; {@link isInside} is the read.
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
 * Take the post inside `building`: stand on its own tile and remember the doorstep to come back to. The
 * caller has already stepped the settler in; this is the extra move a GARRISON makes, so its shot leaves
 * the tower instead of its doorstep (see {@link Garrison}).
 *
 * This and {@link standDownFromPost} are the only writes to a settler's `Position` outside the movement
 * system, and they land it on a building's own (walk-blocked) node. Every incremental spatial structure is
 * keyed on static entities, never on settler positions, so nothing desynchronizes today - but a new
 * settler-position-keyed index would have to account for these two.
 */
export function takePost(world: World, e: Entity, building: Entity): void {
  const at = world.tryGet(building, Position);
  const from = world.tryGet(e, Position);
  if (at === undefined || from === undefined) return;
  world.add(e, Garrison, { post: building, returnTo: { x: from.x, y: from.y } });
  from.x = at.x;
  from.y = at.y;
}

/**
 * Leaving the building ends any garrison duty. The doorstep is restored only while the settler is still
 * standing where {@link takePost} put it: another drive (a player walk, an equip errand, a flee) can march
 * a garrison off its tower without passing through here, and putting THAT settler back on a doorstep it
 * has already left would teleport it across the map. No-op for anyone holding no post.
 */
function standDownFromPost(world: World, e: Entity): void {
  const held = world.tryGet(e, Garrison);
  if (held === undefined) return;
  const pos = world.tryGet(e, Position);
  const at = world.tryGet(held.post, Position);
  if (pos !== undefined && at !== undefined && pos.x === at.x && pos.y === at.y) {
    pos.x = held.returnTo.x;
    pos.y = held.returnTo.y;
  }
  world.remove(e, Garrison);
}
