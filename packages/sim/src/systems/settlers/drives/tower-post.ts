import {
  CurrentAtomic,
  Garrison,
  JobAssignment,
  Settler,
  type SettlerIdentity,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { standsAtPost, towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { needAtomicDuration } from '../../readviews/animations.js';
import { EAT_ATOMIC_ID, eatDuration, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, takePost } from '../indoors.js';
import { interactionCell, storedFoodGood } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

// Standing the watch - the rung of a fighter posted to a tower. His work IS being up there, so this rung
// walks him in and then takes him for every tick he holds it; the shooting is the CombatSystem's
// (../../conflict/tower-post.ts).

/**
 * Man the post `e` is assigned to: walk to the tower's door, step inside, and stand on its tile
 * ({@link takePost}). Returns `true` for every tick the settler is entitled to the post - the ticks it
 * holds it and the ticks it is walking back to it - so no rung below re-tasks a garrison. `false` for
 * anyone who is not a posted fighter, and for a post whose door this settler's routes have already failed
 * to reach: this rung takes the settler for the tick, so looping on an unroutable door would starve every
 * rung under it (the guard `drives/sleep-at-home.ts` applies to a walled-in bed).
 */
export function planTowerPost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  jobType: number,
  here: NodeId,
): boolean {
  const post = towerPostFor(world, ctx, e, jobType);
  if (post === null) return false;
  if (standsAtPost(world, e) === post) return true; // already up there - hold the watch
  const door = interactionCell(world, ctx, terrain, post, here);
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), door)) return false;
  enterBuilding(world, e, post, here, door, () => takePost(world, e, post));
  return true;
}

/**
 * Give the post up: drop the workplace binding, so {@link planTowerPost} stops claiming this settler.
 * Standing the watch has no completion, so nothing else ends it - a garrison walked off its tower with the
 * binding intact climbs straight back on the next re-plan. Stepping off the tile is not done here: the
 * re-plan's garrison stand-down owns that exit and runs the same tick (`planner/replan.ts`). No-op for
 * anyone who is not a posted fighter, so a shared order handler leaves every other worker employed.
 *
 * Source basis: user rule 2026-08-03. The original exposes no readable "leave the tower" primitive; the
 * decision is that the player's next order for that man IS the cancellation.
 */
export function releaseTowerPost(world: World, ctx: SystemContext, e: Entity): void {
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType == null || towerPostFor(world, ctx, e, jobType) === null) return;
  world.remove(e, JobAssignment);
}

/**
 * Feed a garrison out of its own tower's larder, without coming down: both towers stock food
 * (`logicstock 43 25` mead and `16 25` simple food), so a stocked post keeps its wall manned through a meal
 * and only an EMPTY one sends the garrison out to eat (user rule 2026-08-03; the data gives the larder, not
 * who may eat from it without leaving). Returns `false` when the settler holds no post or its post has
 * nothing edible, so the needs ladder falls through to the walk to the nearest larder.
 */
export function eatAtPost(world: World, ctx: SystemContext, e: Entity, settler: SettlerIdentity): boolean {
  const post = standsAtPost(world, e);
  if (post === null) return false;
  const goodType = storedFoodGood(world, ctx, post);
  if (goodType === null) return false;
  startAtomic(
    world,
    e,
    EAT_ATOMIC_ID,
    { kind: 'eat', goodType, from: post },
    eatDuration(ctx, settler),
    post,
  );
  return true;
}

/** Bed a garrison down where it stands: it sleeps at its post rather than walking home and leaving the wall
 *  unmanned. Source basis: `jobtypes.ini` marks every soldier class `ignoresHomeHouseFlag 1` - a soldier
 *  does not keep his home house - so sleeping on station is the data's reading, though it names no bed.
 *  `false` for a settler holding no post, so the needs ladder falls through to its own bed or the open
 *  ground. */
export function sleepAtPost(world: World, ctx: SystemContext, e: Entity, settler: SettlerIdentity): boolean {
  if (standsAtPost(world, e) === null) return false;
  startAtomic(
    world,
    e,
    SLEEP_ATOMIC_ID,
    { kind: 'sleep' },
    needAtomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
    e,
  );
  return true;
}

/** Whether the needs drive that just fired served its need IN PLACE, leaving the garrison on its post -
 *  the case `./ladder.ts` must not step out. A need served in place starts an atomic on the spot; one that
 *  must be walked to sets a route instead. */
export function holdsPostThroughNeed(world: World, e: Entity): boolean {
  return world.has(e, Garrison) && world.has(e, CurrentAtomic);
}
