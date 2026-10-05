import type { ContentSet } from '@open-northland/data';
import {
  Chat,
  CurrentAtomic,
  chatAtomicRunning,
  Engagement,
  FamilyDuty,
  FarmTask,
  Fleeing,
  Frightened,
  Garrison,
  HuntFocus,
  IdleStand,
  inPastimeChat,
  JobAssignment,
  MoveGoal,
  ownerOf,
  PathFollow,
  PathRequest,
  PickupClaim,
  PlayerOrder,
  Position,
  Resting,
  removeCurrentAtomic,
  Settler,
  Sheltering,
  Stranded,
  SupplyRun,
  UnreachableGoals,
  UnreachableTargets,
  Wedding,
  YardDeliveryRoute,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import { isManningPost } from '../../conflict/tower-post.js';
import { pruneUnreachableTargets } from '../../conflict/unreachable-targets.js';
import type { SystemContext } from '../../context.js';
import type { ShelterSites } from '../../defence/index.js';
import { clearNavState, isTravelling } from '../../movement/nav-state.js';
import { sheltersOnAlarm } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import type { SupplyTally } from '../../stores/index.js';
import { ACTION_OWNER_MARKERS, anotherSystemOwns } from '../action-owner.js';
import { atomicHoldsSettler } from '../atomics/busy.js';
import { topsUpAtHome } from '../drives/at-home.js';
import { reconcileYardRoute } from '../drives/economy/index.js';
import { type FarmClaims, releaseFarmTask } from '../drives/farming/index.js';
import { answerNeedInPlace } from '../drives/needs.js';
import { planShelter } from '../drives/shelter.js';
import { heldIndoors, stepOut } from '../indoors.js';
import { markLostWay } from '../lost-way.js';
import { noteUnreachableGoal, pruneUnreachableGoals } from '../unreachable-goals.js';
import { waitsIdle } from './idle-replan.js';

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
  const centre = positionOfNode(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  return p.x === centre.x && p.y === centre.y;
}

/**
 * Answer a combatant's pressing need mid-route, which the drive ladder cannot do because it never runs for a
 * travelling settler. A meal stops the walk, since nothing else pauses a path follower; waiting for the end
 * of a leg keeps the eater on the lattice. A draught needs no stop. A failed route is left alone so the
 * chase still reads its flag.
 */
function feedOnTheMarch(world: World, ctx: SystemContext, e: Entity, routeFailed: boolean): void {
  if (routeFailed || !combatOwnsFeet(world, e) || !onNodeCentre(world, e)) return;
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !answerNeedInPlace(world, ctx, e, settler)) return;
  clearNavState(world, e);
}

/**
 * Whether travelling or fleeing `e` of a trade that takes cover claims a door of its owner's buildings on
 * alarm, which only a player order, an existing shelter or buildings with no place left keep it from.
 */
function seeksShelterEnRoute(world: World, ctx: SystemContext, e: Entity, shelters: ShelterSites): boolean {
  const settler = world.tryGet(e, Settler);
  if (
    settler === undefined ||
    !takesCoverFrom(world, ctx.content, e, shelters) ||
    ctx.terrain === undefined ||
    world.has(e, Sheltering) ||
    world.has(e, PlayerOrder) ||
    !(isTravelling(world, e) || world.has(e, Fleeing)) ||
    !shelterHasRoom(shelters, ownerOf(world, e))
  ) {
    return false;
  }
  const p = world.get(e, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
  return planShelter(
    world,
    ctx,
    ctx.terrain,
    e,
    settler,
    ctx.terrain.nodeAtClamped(hx, hy),
    hx,
    hy,
    navigationLimitFor(world, ctx.content, ctx.terrain, e),
    shelters,
  );
}

/** The stores {@link idleRelease} reads: their membership, and the values below. */
export const RELEASE_IDLE_MEMBERSHIP: readonly Component<unknown>[] = [
  YardDeliveryRoute,
  UnreachableGoals,
  UnreachableTargets,
  Garrison,
  IdleStand,
  CurrentAtomic,
  Chat,
  MoveGoal,
  PathRequest,
  PathFollow,
  SupplyRun,
  PickupClaim,
  FarmTask,
  Resting,
  JobAssignment,
  Sheltering,
  // Engagement, Wedding and FamilyDuty among them.
  ...ACTION_OWNER_MARKERS,
];
export const RELEASE_IDLE_VALUES: readonly Component<unknown>[] = [CurrentAtomic, Chat, PathRequest, Settler];

/**
 * Why the sweep's visit of a settler changes nothing: an atomic holds it or it walks a quiet route, so
 * {@link releaseStaleIntent} passes it by; it has no trade and nothing that call sheds, so no ladder
 * runs after it; or it stands idle off its re-plan beat, where the idle gate skips a release that sheds
 * nothing or the whole visit of a wait inside a building.
 */
export type IdleRelease = 'held' | 'travelling' | 'jobless' | 'idle';

/**
 * How the sweep's visit of `e` changes nothing, or null when it may: an atomic holds it, or it walks
 * a live route that only a shelter of its owner on alarm diverts ({@link takesCoverFrom}), and it
 * carries nothing {@link releaseStaleIntent} reconciles on the way or the busy branch wakes, a supply
 * errand mattering only once another system owns the walker; or it has no trade and nothing to shed,
 * which an alarm never draws; or it stands idle carrying nothing that call sheds, or waits inside a
 * building ({@link waitsInside}). Keep in step with that call's early-outs.
 */
export function idleRelease(world: World, e: Entity): IdleRelease | null {
  if (world.has(e, YardDeliveryRoute) || world.has(e, UnreachableGoals) || world.has(e, UnreachableTargets)) {
    return null;
  }
  if (world.has(e, IdleStand)) return shedsNothing(world, e) || waitsInside(world, e) ? 'idle' : null;
  if (world.has(e, Garrison)) return null;
  if (atomicHoldsSettler(world, e)) return 'held';
  if (world.get(e, Settler).jobType === null && shedsNothing(world, e)) return 'jobless';
  const quiet =
    isTravelling(world, e) &&
    !(hasErrand(world, e) && anotherSystemOwns(world, e)) &&
    !world.has(e, Engagement) &&
    world.tryGet(e, PathRequest)?.failed !== true;
  return quiet ? 'travelling' : null;
}

/** Whether the settler holds a supply run or a pickup claim, the errands a re-plan releases. */
function hasErrand(world: World, e: Entity): boolean {
  return world.has(e, SupplyRun) || world.has(e, PickupClaim);
}

/** Whether {@link releaseStaleIntent} returns true for `e` without a write: nothing holds or walks it,
 *  no errand or farm claim to release, not indoors or on a post, and no clip but a pastime chat's, which
 *  it keeps. A flight only matters to an alarm, and the sweep visits every idler an alarm may draw every
 *  tick. */
function shedsNothing(world: World, e: Entity): boolean {
  return (
    !world.has(e, Garrison) &&
    !isTravelling(world, e) &&
    !hasErrand(world, e) &&
    !world.has(e, FarmTask) &&
    !world.has(e, Resting) &&
    (!world.has(e, CurrentAtomic) || (inPastimeChat(world, e) && chatAtomicRunning(world, e)))
  );
}

/**
 * Whether idle `e` waits inside the building that holds it: seated at its craft or waiting there for an
 * input on its way, manning its tower, or under cover. Its visit off its beat runs nothing, since
 * {@link releaseStaleIntent} would shed the wait the ladder re-derives; a batch change or the end of the
 * cover wakes it, and losing the building's hold makes it re-plan at once.
 */
function waitsInside(world: World, e: Entity): boolean {
  const at = world.tryGet(e, Resting)?.at;
  const holder = world.tryGet(e, Sheltering)?.shelter ?? world.tryGet(e, JobAssignment)?.workplace;
  if (
    at === undefined ||
    at !== holder ||
    isTravelling(world, e) ||
    hasErrand(world, e) ||
    world.has(e, FarmTask) ||
    world.has(e, Engagement) ||
    world.has(e, Chat) ||
    world.has(e, FamilyDuty)
  ) {
    return false;
  }
  const atomic = world.tryGet(e, CurrentAtomic);
  return atomic === undefined || (atomic.effect.kind === 'produce' && !world.has(e, Wedding));
}

/** Whether `e` keeps its wait through this pass: {@link waitsInside} off its beat, and no alarm of its
 *  owner may draw it, which runs its whole ladder. */
export function standsThroughPass(
  world: World,
  ctx: SystemContext,
  shelters: ShelterSites,
  e: Entity,
): boolean {
  if (!waitsIdle(world, ctx.tick, e) || !waitsInside(world, e)) return false;
  return shelters.size === 0 || world.has(e, Sheltering) || !takesCoverFrom(world, ctx.content, e, shelters);
}

/** Whether one of `owner`'s buildings on alarm has a place left this pass. A pass only hands places out,
 *  so once this fails it fails for the rest of the pass. */
export function shelterHasRoom(shelters: ShelterSites, owner: number | undefined): boolean {
  const sites = owner === undefined ? undefined : shelters.get(owner);
  if (sites === undefined) return false;
  for (const site of sites) if (site.free > 0) return true;
  return false;
}

/** Whether one of `e`'s owner's buildings on alarm may draw it off its route or its idle wait: the owner
 *  has one, and `e` is of a trade that runs for cover. */
export function takesCoverFrom(
  world: World,
  content: ContentSet,
  e: Entity,
  shelters: ShelterSites,
): boolean {
  const owner = ownerOf(world, e);
  if (owner === undefined || !shelters.has(owner)) return false;
  const jobType = world.tryGet(e, Settler)?.jobType ?? null;
  return jobType !== null && sheltersOnAlarm(content, jobType);
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
  supply: SupplyTally,
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
  const seekShelter = shelters.size > 0 && seeksShelterEnRoute(world, ctx, e, shelters);
  // An alarm outranks an autonomous economy route. Let the shelter rung select a real door this pass;
  // only a successful claim may displace flight. The old PathFollow remains for a continuous mid-leg
  // splice, but an old request cannot block the new goal.
  if (seekShelter) {
    world.remove(e, Fleeing);
    world.remove(e, PathRequest);
    if (world.tryGet(e, Resting)?.at === world.get(e, Sheltering).shelter) clearNavState(world, e);
  }
  // A non-atomic owner has diverted this settler from its errand. Release its promises before a combat,
  // flight, family or player-order route hits the travel early-out below.
  if (anotherSystemOwns(world, e)) supply.releaseErrands(e);
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
  // garrison still on its tower keeps it because anything else already gave the post up above. One
  // outdoors has nothing to step out of, and a garrison counts as held.
  if (world.has(e, Resting) && !heldIndoors(world, e) && !topsUpAtHome(world, ctx, e)) stepOut(world, e);
  // The guard above returned for anything the atomic holds, so what is left is safe to shed: the producer
  // drive below re-derives a craft clip from its workplace's own batch clock in this same pass, and a
  // pastime chat's clip is shed with the chat once a drive takes the settler.
  if (!inPastimeChat(world, e)) removeCurrentAtomic(world, e);
  // Releasing through the tally keeps its counts in lockstep with the store.
  supply.releaseErrands(e);
  return true;
}
