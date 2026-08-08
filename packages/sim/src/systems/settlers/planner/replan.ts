import {
  Chat,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  Frightened,
  Garrison,
  LivestockVisit,
  PathRequest,
  PlayerOrder,
  Sheltering,
  Stranded,
  Wedding,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isManningPost } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { clearNavState, isTravelling } from '../../spatial/nodes.js';
import { type InboundSupplyTally, releaseSupplyRun } from '../../stores/index.js';
import { reconcileYardRoute } from '../drives/economy/index.js';
import { type FarmClaims, releaseFarmTask } from '../drives/farming/index.js';
import { stepOut } from '../indoors.js';
import { noteUnreachableGoal, pruneUnreachableGoals } from '../unreachable-goals.js';

/** How long a stranded walker parks before shedding its failed route and re-planning: long enough that
 *  a permanently blocked target costs one path query per episode, short enough that a transient
 *  blockage heals within seconds. Approximation, the original's retry cadence is not readable. */
const STRANDED_RETRY_TICKS = 4 * TICKS_PER_SECOND;

/** Whether a drive that runs its own failed-route protocol owns `e`'s walk, since it reads and clears
 *  the `failed` flag itself and the planner's stranded recovery must not eat that signal. Narrower than
 *  {@link anotherSystemOwns}: a guard's post and family duty hold a settler off the economy without
 *  owning a route's failure signal. */
function ownsFailedRoute(world: World, e: Entity): boolean {
  return (
    world.has(e, PlayerOrder) ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, Frightened) ||
    world.has(e, Wedding) ||
    world.has(e, Chat)
  );
}

/**
 * Whether a system outside the planner currently owns `e`'s actions, so the economy ladder must not
 * re-task it. Each marker's owner clears it when its episode ends.
 *
 * The DEFEND-stance hold is deliberately not here: it lives in the drive ladder instead.
 */
export function anotherSystemOwns(world: World, e: Entity): boolean {
  return (
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    world.has(e, Chat)
  );
}

/**
 * Reconcile `e`'s leftover intent and report whether the drive ladder should run for it this tick.
 *
 * Returns false while the settler is spoken for: an atomic is running, it walks a live route, or it
 * parks a failed one. A failed route is not travel and nothing on the nav side retries it, so a settler
 * left in that state would stand forever.
 *
 * Returns true once the settler is genuinely re-planning, having released what the previous intent held.
 * A drive that still wants one of those holds re-stamps it within the same tick, so the render never sees
 * a gap, and releasing the farm claim keeps a settler from blocking itself out of the field it walked to.
 */
export function releaseStaleIntent(
  world: World,
  ctx: SystemContext,
  e: Entity,
  farmClaims: FarmClaims,
  inbound: InboundSupplyTally,
): boolean {
  reconcileYardRoute(world, e);
  pruneUnreachableGoals(world, ctx, e);
  // A garrison that no longer mans its tower gives the post up above the busy and travel early-outs:
  // the marker hides it from the render, so waiting for it to fall idle would march an invisible
  // settler across the map.
  if (world.has(e, Garrison) && !isManningPost(world, ctx, e)) stepOut(world, e);
  if (world.has(e, CurrentAtomic)) return false;
  // Fresh read - reconcileYardRoute may have cleared the request.
  const request = world.tryGet(e, PathRequest);
  if (request?.failed === true && !ownsFailedRoute(world, e)) {
    const stranded = world.tryGet(e, Stranded);
    if (stranded === undefined) {
      world.add(e, Stranded, { retryAt: ctx.tick + STRANDED_RETRY_TICKS });
      return false;
    }
    if (ctx.tick < stranded.retryAt) return false;
    // Remember what failed before shedding the route: the re-plan runs the same deterministic
    // nearest-first pick, so without the memo it re-chooses this very goal and loops forever.
    noteUnreachableGoal(world, ctx, e, request.goal);
    clearNavState(world, e); // sheds Stranded with the route - fall through and re-plan this tick
  } else if (isTravelling(world, e)) {
    return false;
  }
  releaseFarmTask(world, e, farmClaims);
  // These holds keep their Resting through a re-plan because other systems own those exits: shedding a
  // sheltering settler's marker would pop it out of cover and back in every tick the alarm stands. A
  // garrison still on its tower keeps it too; anything else already gave the post up above.
  if (
    !world.has(e, FamilyDuty) &&
    !world.has(e, LivestockVisit) &&
    !world.has(e, Garrison) &&
    !world.has(e, Sheltering)
  ) {
    stepOut(world, e);
  }
  // Releasing through the tally keeps the inbound count in lockstep with the store.
  releaseSupplyRun(world, e, inbound);
  return true;
}
