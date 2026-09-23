import {
  Chat,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Frightened,
  Garrison,
  HuntFocus,
  inPastimeChat,
  ownerOf,
  PathRequest,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  Sheltering,
  Stranded,
  Wedding,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import { isManningPost } from '../../conflict/tower-post.js';
import { pruneUnreachableTargets } from '../../conflict/unreachable-targets.js';
import type { SystemContext } from '../../context.js';
import type { ShelterSites } from '../../defence/index.js';
import { clearNavState, isTravelling } from '../../movement/nav-state.js';
import { sheltersOnAlarm } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { type InboundSupplyTally, releaseSupplyRun } from '../../stores/index.js';
import { anotherSystemOwns } from '../action-owner.js';
import { atomicHoldsSettler } from '../atomics/busy.js';
import { topsUpAtHome } from '../drives/at-home.js';
import { reconcileYardRoute } from '../drives/economy/index.js';
import { type FarmClaims, releaseFarmTask } from '../drives/farming/index.js';
import { answerNeedInPlace } from '../drives/needs.js';
import { planShelter } from '../drives/shelter.js';
import { heldIndoors, stepOut } from '../indoors.js';
import { markLostWay } from '../lost-way.js';
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
 * Whether combat owns `e`'s feet, so a pressing need may only be answered where it stands. A self-committed
 * hunter is excluded: its chase is an economy errand, and gating it off the food ladder would starve a
 * working settler. The opposite call is made for flight, where `conflict/flee.ts` lets a collapsing need
 * stop a fleeing settler even in danger; a fighting unit holds instead, at any level.
 */
export function combatOwnsFeet(world: World, e: Entity): boolean {
  return world.has(e, Engagement) && !world.has(e, HuntFocus);
}

/** Whether `e` stands on a node's exact centre. A path follower snaps onto each waypoint before advancing
 *  its index, so a walker is on-lattice for the tick that ends any leg. */
function onNodeCentre(world: World, e: Entity): boolean {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  const centre = positionOfNode(n.hx, n.hy);
  return p.x === centre.x && p.y === centre.y;
}

/**
 * Answer a combatant's pressing need mid-route, which the drive ladder cannot do because it never runs for a
 * travelling settler. The walk stops for it, since nothing else pauses a path follower; waiting for the end
 * of a leg keeps the eater on the lattice. A failed route is left alone so the chase still reads its flag.
 */
function feedOnTheMarch(world: World, ctx: SystemContext, e: Entity, routeFailed: boolean): void {
  if (routeFailed || !combatOwnsFeet(world, e) || !onNodeCentre(world, e)) return;
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !answerNeedInPlace(world, ctx, e, settler)) return;
  clearNavState(world, e);
}

export { anotherSystemOwns } from '../action-owner.js';

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
  shelters: ShelterSites,
): boolean {
  reconcileYardRoute(world, e);
  pruneUnreachableGoals(world, ctx, e);
  pruneUnreachableTargets(world, ctx, e);
  // A garrison that no longer mans its tower gives the post up above the busy and travel early-outs:
  // the marker hides it from the render, so waiting for it to fall idle would march an invisible
  // settler across the map.
  if (world.has(e, Garrison) && !isManningPost(world, ctx, e)) stepOut(world, e);
  if (atomicHoldsSettler(world, e)) return false;
  const settler = world.tryGet(e, Settler);
  const owner = ownerOf(world, e);
  let seekShelter = false;
  if (
    !world.has(e, Sheltering) &&
    !world.has(e, PlayerOrder) &&
    settler !== undefined &&
    settler.jobType !== null &&
    sheltersOnAlarm(ctx.content, settler.jobType) &&
    owner !== undefined &&
    shelters.has(owner) &&
    ctx.terrain !== undefined &&
    (isTravelling(world, e) || world.has(e, Fleeing))
  ) {
    const p = world.get(e, Position);
    const from = nodeOfPosition(p.x, p.y);
    const here = ctx.terrain.nodeAtClamped(from.hx, from.hy);
    seekShelter = planShelter(
      world,
      ctx,
      ctx.terrain,
      e,
      settler,
      here,
      from,
      navigationLimitFor(world, ctx.content, ctx.terrain, e),
      shelters,
    );
  }
  // An alarm outranks an autonomous economy route. Let the shelter rung select a real door this pass;
  // only a successful claim may displace flight. The old PathFollow remains for a continuous mid-leg
  // splice, but an old request cannot block the new goal.
  if (seekShelter) {
    world.remove(e, Fleeing);
    world.remove(e, PathRequest);
    if (world.tryGet(e, Resting)?.at === world.get(e, Sheltering).shelter) clearNavState(world, e);
  }
  // A non-atomic owner has diverted this settler from its construction errand. Release both promises
  // before a combat, flight, family or player-order route hits the travel early-out below.
  if (anotherSystemOwns(world, e)) releaseSupplyRun(world, e, inbound);
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
    // Wildlife rides this same recovery, and a retry of a goal already given up is not news, so only
    // the first refusal of a goal marks the settler lost.
    if (noteUnreachableGoal(world, ctx, e, request.goal)) markLostWay(world, ctx, e);
    clearNavState(world, e); // sheds Stranded with the route - fall through and re-plan this tick
  } else if (isTravelling(world, e) && !seekShelter) {
    feedOnTheMarch(world, ctx, e, request?.failed === true);
    return false;
  }
  releaseFarmTask(world, e, farmClaims);
  // These holds keep their Resting through a re-plan because other systems own those exits: shedding a
  // sheltering settler's marker would pop it out of cover and back in every tick the alarm stands. A
  // settler mid-way through its at-home top-up keeps it too, so the chain runs its rounds indoors, and a
  // garrison still on its tower keeps it because anything else already gave the post up above.
  if (!heldIndoors(world, e) && !topsUpAtHome(world, ctx, e)) stepOut(world, e);
  // The guard above returned for anything the atomic holds, so what is left is safe to shed: the producer
  // drive below re-derives a craft clip from its workplace's own batch clock in this same pass, and a
  // pastime chat's clip is shed with the chat once a drive takes the settler.
  if (!inPastimeChat(world, e)) world.remove(e, CurrentAtomic);
  // Releasing through the tally keeps the inbound count in lockstep with the store.
  releaseSupplyRun(world, e, inbound);
  return true;
}
