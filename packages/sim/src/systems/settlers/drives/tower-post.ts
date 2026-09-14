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
import { atomicDuration } from '../../readviews/animations.js';
import { EAT_ATOMIC_ID, eatDuration, SLEEP_ATOMIC_ID, startAtomic } from '../atomics/start.js';
import { enterBuilding, stepOut, takePost } from '../indoors.js';
import { interactionCell, storedFoodGood } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';

// Standing the watch: a fighter posted to a tower. His work is being up there, so this rung walks him in
// and then takes him for every tick he holds it; the shooting is the CombatSystem's.

/**
 * Man the post `e` is assigned to: walk to the tower's door, step inside, and stand on its tile. Returns
 * true for every tick the settler is entitled to the post, so no rung below re-tasks a garrison; false for
 * anyone who is not a posted fighter, and for a post whose door this settler's routes have already failed
 * to reach, since looping on an unroutable door would starve every rung under it.
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
  if (standsAtPost(world, e) === post) return true;
  const door = interactionCell(world, ctx, terrain, post, here);
  if (isUnreachableGoal(unreachableGoals(world, ctx, e), door)) return false;
  enterBuilding(world, e, post, here, door, () => takePost(world, e, post));
  return true;
}

/**
 * Give the post up: step off the tower and drop the workplace binding, so `planTowerPost` stops claiming
 * this settler. Standing the watch has no completion, so nothing else ends it. The exit is taken here
 * rather than left to the next re-plan because a deferred order re-dispatches after the planner has run,
 * and that tick's combat pass would read a man standing on a post he no longer holds.
 *
 * Source basis: authored, since the original has no readable "leave the tower" primitive; the player's next
 * order for that man is the cancellation.
 */
export function releaseTowerPost(world: World, ctx: SystemContext, e: Entity): void {
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType == null || towerPostFor(world, ctx, e, jobType) === null) return;
  world.remove(e, JobAssignment);
  stepOut(world, e);
}

/**
 * Feed a garrison out of its own tower's larder without coming down: both towers stock food
 * (`logicstock 43 25` mead and `16 25` simple food), so only an empty post sends the garrison out to eat.
 * Returns false when the settler holds no post or its post has nothing edible. Source basis: authored, the
 * data gives the larder but not who may eat from it without leaving.
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

/** Bed a garrison down where it stands rather than walk home and leave the wall unmanned. Source basis:
 *  `jobtypes.ini` marks every soldier class `ignoresHomeHouseFlag 1`, so sleeping on station is the data's
 *  reading, though it names no bed. */
export function sleepAtPost(world: World, ctx: SystemContext, e: Entity, settler: SettlerIdentity): boolean {
  if (standsAtPost(world, e) === null) return false;
  startAtomic(
    world,
    e,
    SLEEP_ATOMIC_ID,
    { kind: 'sleep' },
    atomicDuration(ctx.content, settler, SLEEP_ATOMIC_ID),
    e,
  );
  return true;
}

/** Whether the needs drive that just fired served its need in place, leaving the garrison on its post. A
 *  need served in place starts an atomic on the spot; one that must be walked to sets a route instead. */
export function holdsPostThroughNeed(world: World, e: Entity): boolean {
  return world.has(e, Garrison) && world.has(e, CurrentAtomic);
}
