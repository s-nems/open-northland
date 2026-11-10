import {
  Carrying,
  Chat,
  CurrentAtomic,
  Engagement,
  Female,
  HuntFocus,
  hasMissionBehaviour,
  LostWay,
  MealBreak,
  MISSION_BEHAVIOUR,
  MoveGoal,
  ownerOf,
  Position,
  Rider,
  SettlerProgress,
  type SettlerView,
  Sheltering,
  Stance,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import { standsAtPost } from '../../conflict/tower-post.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { planWomanHoard } from '../../family/hoard.js';
import { planChildWander } from '../../family/wander.js';
import { endMealBreak } from '../../orders/meal-break.js';
import { isFisherJob, MILITARY_MODE } from '../../readviews/index.js';
import { type NavigationLimit, navigationLimitFor } from '../../signposts/index.js';
import { planGossipIdle, planGossipSeek } from '../../social/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { planShipHelper, planTrader } from '../../trade/index.js';
import { planRider } from '../../vehicles/boarding.js';
import { abandonCargoRun } from '../../vehicles/cargo.js';
import { pinnedTraderOf } from '../../vehicles/crew.js';
import { parkHaulingCart } from '../../vehicles/hauling-cart.js';
import { heldOffEconomy } from '../action-owner.js';
import { jobCanBuild } from '../atomics/start.js';
import { isInside, stepOut } from '../indoors.js';
import { forgetWorkTried, noteWorkTaken } from '../lost-way.js';
import type { PlannerContext } from '../planner/context.js';
import {
  guardWaitsOnBeat,
  idleReplanDue,
  idleReplanPeriodOf,
  waitsHoldOnBeat,
} from '../planner/idle-replan.js';
import type { PlannerPass } from '../planner/pass.js';
import { combatOwnsFeet, shelterHasRoom } from '../planner/replan.js';
import { boundWorkplaceTarget } from '../targets/index.js';
import { planHomeTopUp } from './at-home.js';
import { cutOffCheckDue, reconcileCutOff, strandedPost } from './cut-off.js';
import {
  builderWorkBeyondReach,
  planBuilder,
  planCarrierHaul,
  planCartTopUp,
  planDelivery,
  planFisher,
  planGatherer,
  planHaulingCart,
  planPorter,
  planProducer,
  planSiteStaff,
  planVehicleCargo,
  planWaitAtFieldFlag,
  planWorkshopSupplier,
} from './economy/index.js';
import { planEquipOrder } from './equip-order.js';
import { planFarmer } from './farming/index.js';
import { planGraduateWait } from './graduate-wait.js';
import { isServedAtHome } from './home-errands.js';
import { planBreeder } from './husbandry/index.js';
import { guideLostSettler } from './lost-guide.js';
import { answerNeedInPlace, dropUnservedNeedOrder, orderedNeed, planMealBreak, planNeeds } from './needs.js';
import { planShelter } from './shelter.js';
import { deStackGuard, deStackIdle, stepOffHomeDoor } from './spacing.js';
import { holdsPostThroughNeed, planTowerPost } from './tower-post.js';
import { planTraining } from './training.js';

// The drive ladder: pick the next atomic for one idle settler. Each drive returns `true` when it takes
// the settler for the tick, and the rung order is a behavior contract the state goldens cover.

/**
 * Plan a growing settler: shelter first, else a stroll, weighed on its seat's idle beat only, which is
 * what lets the sweep pass an idle one by between beats. It carries no needs of its own (approximation,
 * see `lifecycle/needs/system.ts`), so no needs rung runs for it. It still runs for cover like anyone
 * else, though it never mans the walls (`defence/manning.ts`).
 */
export function planChild(pass: PlannerPass, e: Entity, settler: SettlerView): void {
  if (planShelterRung(pass, e, settler)) return;
  const { world, ctx } = pass;
  if (staysPut(world, e)) return;
  const beat = idleReplanPeriodOf(world, e);
  if (!idleReplanDue(ctx.tick, e, beat)) return;
  planChildWander(world, ctx, pass.terrain, e, pass.spacing, beat);
}

/** The ladder's top rung alone, free while nothing is on alarm: what an idler runs between its idle beats,
 *  so an alarm still draws it indoors within a tick. */
export function planShelterRung(pass: PlannerPass, e: Entity, settler: SettlerView): boolean {
  if (pass.shelters.size === 0) return false;
  const { world, ctx, terrain } = pass;
  // Without a held shelter, the rung only claims a place its owner still has: refuse before the reads.
  if (!world.has(e, Sheltering) && !shelterHasRoom(pass.shelters, ownerOf(world, e))) return false;
  const p = world.get(e, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hx, hy);
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  if (!planShelter(world, ctx, terrain, e, settler, here, hx, hy, limit, pass.shelters)) return false;
  parkHaulingCart(world, ctx, e); // an idle carrier with its cart in hand leaves it for the shelter
  return true;
}

/** A needs drive pulled `e` away, so it is no longer inside whatever it was waiting in - unless it is the
 *  home the sleep or pray rung just put it in, or a garrison that served its need on the spot and is
 *  still holding the tower. A hunter's chase is the only engagement that reaches a needs rung; dropping
 *  it and the prey hold keeps the CombatSystem off the errand, and the hunter picks its prey afresh once
 *  the need is met. */
function leaveForNeed(world: World, e: Entity): void {
  if (!isServedAtHome(world, e) && !holdsPostThroughNeed(world, e)) stepOut(world, e);
  world.remove(e, Engagement);
  world.remove(e, HuntFocus);
}

/** Plan one idle adult. `jobType` is the caller's non-null narrowing of `settler.jobType`. */
export function planAdult(pass: PlannerPass, e: Entity, settler: SettlerView, jobType: number): void {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hx, hy);
  const load = world.tryGet(e, Carrying);
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  // A fresh plan: the work walk the mark waited on, if any, is over, found or failed.
  forgetWorkTried(world, e);

  const plan = plannerContextOf(pass, e, settler, jobType, here, limit);
  // The battle alert: a rear rank neither lies down nor wanders off while the front rank fights. Asked at
  // most once per settler per tick, and only by a rung whose answer it changes, which each rung does after
  // its own cheap refusals - the presence sweep behind it is the pass's one expensive read.
  const alert = pass.alert.of(e);
  dropEmptyHandedShipRun(world, e, load);
  if (planBreak(pass, plan, settler, load, hx, hy, alert)) {
    // Whatever took the carrier off its trade parks its hauling cart where it stands; the rung below
    // takes the cart up again once the trade is back on. A meal from its own hands is eaten on the spot
    // with the cart in hand: parked, the food would be stowed out of the meal's reach.
    if (!eatsFromHands(world, e)) parkHaulingCart(world, ctx, e);
    return;
  }
  // A posted carrier handed a cart, or back from a break, fetches it before its hauls, once its hands are
  // free; a hold that no longer stands sets the cart down here, whatever the carrier does next.
  if (planHaulingCart(plan, load !== undefined && load.amount > 0)) return;
  planEconomy(plan, pass, settler, load, hx, hy, alert);
}

/** A pinned ship's helper with empty hands holds no unit of its run, so a need or an order taking it
 *  gives the run back rather than keep the trader waiting; the helper rung books afresh if it still
 *  works the ship. A loaded helper keeps its booking to finish the trip. Other cargo hands keep theirs. */
function dropEmptyHandedShipRun(
  world: World,
  e: Entity,
  load: { goodType: number; amount: number } | undefined,
): void {
  if (load !== undefined && load.amount > 0) return;
  const ship = world.tryGet(e, Rider)?.vehicle;
  if (ship === undefined) return;
  const trader = pinnedTraderOf(world, ship);
  if (trader !== null && trader !== e) abandonCargoRun(world, e);
}

/** A settler eating a unit it carries, the one break that spends what is in its hands. */
function eatsFromHands(world: World, e: Entity): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  return atomic !== undefined && atomic.effect.kind === 'eat' && atomic.effect.from === null;
}

/**
 * Everything above an adult's trade, most pressing first: the alarm, the needs and their orders, the
 * ownership gate, a vehicle's crew work, the player's drill and equip errands, a soldier's standing
 * orders, company and the housewife's larder. True when a rung took the settler for the tick.
 */
function planBreak(
  pass: PlannerPass,
  plan: PlannerContext,
  settler: SettlerView,
  load: { goodType: number; amount: number } | undefined,
  hx: number,
  hy: number,
  alert: () => boolean,
): boolean {
  const { world, ctx, terrain, entity: e, here, limit, jobType } = plan;
  // The alarm outranks every other drive: hunger, the ownership gate, and a live equip errand alike.
  if (planShelter(world, ctx, terrain, e, settler, here, hx, hy, limit, pass.shelters)) {
    standIfInside(pass, e, world.get(e, Sheltering).shelter);
    // The need rungs wait out the alarm, so orders queued behind a need order do not.
    dropUnservedNeedOrder(world, e);
    return true;
  }

  // A pressing need on a fighting unit is answered from what it carries or what its post holds, never by
  // walking to food, a bed or a temple and never by lying down. Under the alarm, which still outranks
  // combat. Departure: the manual gives the need rule no combat exemption and carves a soldier out only for
  // sleeping at home, so leaving an unprovisioned fighter to go without is a deliberate choice. A need the
  // player ordered is the exception: the fight is broken off for it and the full ladder below runs, so
  // ordering a meal is how a player feeds an army that would otherwise starve in the line.
  if (combatOwnsFeet(world, e)) {
    if (orderedNeed(world, e) === undefined) {
      answerNeedInPlace(world, ctx, e, settler);
      return true;
    }
    // Breaking off here rather than in the CombatSystem, which runs later in the tick, so the rungs below
    // plan the errand into a unit the fight no longer holds. Only the engagement goes: the route is left
    // for whatever rung replaces it, and an attack order the player gave is the player's to cancel -
    // `orderNeed` retires it when the order lands. A unit with nowhere to go for its meal is re-engaged
    // by the CombatSystem this same tick, which beats standing in the line doing nothing.
    world.remove(e, Engagement);
  }

  // A player "talk" order ranks with the other need orders rather than with the idle chatter below: the
  // original answers all four needs through one task.
  if (
    orderedNeed(world, e) === 'enjoyment' &&
    planGossipSeek(world, ctx, e, settler, hx, hy, pass.gossipCandidates, true)
  ) {
    return true;
  }

  // A vehicle that asked its crew in takes its empty-handed rider over every need below (owner's choice, a
  // deviation from the original's pending-need gate on the board request): the order is a forced
  // boarding, and a need waits for the ride. Any cargo booking is given back first, and a rider with a
  // unit on its back runs the ladder down to the delivery rung before it answers, so nothing rides
  // aboard in its hands; a helper of a pinned ship keeps its booking and finishes that trip on its own
  // rung. Whatever the rider waited in, it steps out of.
  const seat = world.tryGet(e, Rider);
  if (seat?.boarding === true) {
    const loaded = load !== undefined && load.amount > 0;
    if (!loaded || pinnedTraderOf(world, seat.vehicle) === null) abandonCargoRun(world, e);
    if (!loaded && planRider(world, ctx, terrain, e, pass.spacing, pass.idle)) {
      stepOut(world, e);
      return true;
    }
  }

  // Hunger took the settler off its orders: it eats and nothing else, and once the hunger rung has
  // nothing left to do the break ends and the orders resume next tick, the settler standing until then.
  if (world.has(e, MealBreak)) {
    const meal = {
      terrain,
      settler,
      here,
      load,
      targets: pass.targets,
      supply: pass.supply,
      limit,
      onAlert: alert,
    };
    if (planMealBreak(world, ctx, e, meal)) leaveForNeed(world, e);
    else endMealBreak(world, ctx, e);
    return true;
  }

  // Already home for one need: top the others up before stepping back out, rather than walking the whole
  // errand again for each bar.
  if (planHomeTopUp(world, ctx, e, settler, pass.supply)) return true;

  if (
    planNeeds(
      world,
      ctx,
      terrain,
      e,
      settler,
      here,
      load,
      pass.targets,
      pass.supply,
      limit,
      pass.spacing,
      alert,
    )
  ) {
    leaveForNeed(world, e);
    return true;
  }
  dropUnservedNeedOrder(world, e);

  // Ownership gate, below the needs drives on purpose: hunger, fatigue and piety are soft overrides that
  // still pull the unit away, so a marrying or child-making settler still eats. Engagement is the one
  // member that never gets here, having been answered in place above.
  if (heldOffEconomy(world, e)) {
    if (waitsHoldOnBeat(world, e)) pass.idle.stand(e, false);
    return true;
  }

  // A vehicle's crew, above every errand and trade: a cargo hand serves its vehicle's hold and places a
  // unit the hold will not take; any rider walks to the door and steps in when asked. A rider of no hold
  // work holding a load runs the ladder down to the delivery rung first, so it is not parked at the door
  // with its hands full. A pinned ship's carrier helps its trader first; the rung below refuses it.
  if (planShipHelper(plan, load)) return true;
  if (planVehicleCargo(plan, load)) return true;
  if (
    (load === undefined || load.amount <= 0) &&
    planRider(world, ctx, terrain, e, pass.spacing, pass.idle)
  ) {
    return true;
  }
  // BARRACKS DRILL: a player errand outranking the settler's trade for as long as it lasts, and above the
  // equip errand below because the drill ends in a profession change.
  if (planTraining(plan, settler, pass.spacing, pass.idle, load)) return true;
  // EQUIP ERRAND: the player's or the assistant's, outranking the DEFEND hold below, socialising and every
  // economy rung, but under the needs drives and the ownership gate. A DEFEND guard walks the errand and
  // re-holds its unchanged anchor afterwards, since the combat walk-back pass defers to a live errand. A
  // garrison steps down from his tower first: a route cannot start inside the building's walk-blocked body.
  if (
    planEquipOrder(world, ctx, terrain, e, settler, here, limit, pass.targets, pass.supply, pass.equipFetches)
  ) {
    stepOut(world, e);
    return true;
  }
  // TOWER WATCH: above the DEFEND hold below because it is the more specific standing order - a posted
  // archer whose stance is also DEFEND must still walk to his tower rather than freeze on the spot.
  if (planTowerPost(world, ctx, terrain, e, jobType, here)) {
    const post = standsAtPost(world, e);
    if (post !== null) standIfInside(pass, e, post);
    return true;
  }
  // DEFEND hold: a guard keeps its post against the company and economy rungs, and the CombatSystem walks
  // it back when displaced. Below the equip errand on purpose: the one errand a guard still runs without
  // dropping its stance. A guard sharing its post's node still spaces out like any idler, and one
  // holding still waits for its idle beat, a human seat's unless a workplace binds it.
  if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) {
    if (!staysPut(world, e)) deStackGuard(world, ctx, terrain, e, hx, hy, pass.spacing);
    if (guardWaitsOnBeat(world, e)) pass.idle.stand(e, false);
    return true;
  }
  // The company rung: a lonely settler leaves its work to find a partner, above the economy rungs on
  // purpose - the "worker downs tools to socialize" beat. Nobody walks off to chat while a battle is on
  // nearby: the fighting trades never reach this rung at all (`social/gossip/plan.ts` bars them), so the
  // alert passed down holds the civilian trade a player or a script put into a fighting stance. Its work
  // is left alone - the alert governs rest and company, not a settler's trade.
  if (
    !staysPut(world, e) &&
    planGossipSeek(world, ctx, e, settler, hx, hy, pass.gossipCandidates, false, alert)
  ) {
    return true;
  }
  // The housewife rung: a woman takes no trade - her work is stocking the family larder. Above the
  // carry-delivery rung so food she lifted for the pantry goes home, not to the nearest store.
  if (
    world.has(e, Female) &&
    planWomanHoard(world, ctx, terrain, e, pass.externalFood, pass.externalQuality, pass.supply, limit)
  )
    return true;
  return false;
}

/** The economy context of adult `e` of `jobType` standing on `here` under `limit`, for this pass. The
 *  pass's one {@link PlannerPass.plan} object is rewritten for it, so it is valid until the next call. */
export function plannerContextOf(
  pass: PlannerPass,
  e: Entity,
  settler: SettlerView,
  jobType: number,
  here: NodeId,
  limit: NavigationLimit | null,
): PlannerContext {
  const { world } = pass;
  const experience = world.get(e, SettlerProgress).experience;
  const owner = ownerOf(world, e);
  const plan = pass.plan;
  if (plan === undefined) {
    pass.plan = {
      world,
      ctx: pass.ctx,
      terrain: pass.terrain,
      entity: e,
      tribe: settler.tribe,
      jobType,
      experience,
      owner,
      here,
      targets: pass.targets,
      supply: pass.supply,
      limit,
      gossipCandidates: pass.gossipCandidates,
    };
    return pass.plan;
  }
  plan.entity = e;
  plan.tribe = settler.tribe;
  plan.jobType = jobType;
  plan.experience = experience;
  plan.owner = owner;
  plan.here = here;
  plan.limit = limit;
  return plan;
}

/**
 * The trade (economy) ladder for an employed adult, most-specific-first; each rung is documented at its
 * drive. `hx`/`hy` are the settler's half-cell node coordinates, for the drives that read them raw.
 */
function planEconomy(
  plan: PlannerContext,
  pass: PlannerPass,
  settler: SettlerView,
  load: { goodType: number; amount: number } | undefined,
  hx: number,
  hy: number,
  alert: () => boolean,
): void {
  const { world, ctx, terrain, entity: e } = plan;

  // A trader works its route, a unit of it in its hands included, before the delivery rung below would
  // carry that unit off to a store.
  if (planTrader(plan)) {
    noteWorkTaken(world, e);
    return;
  }

  // Deliver a carried load first: a settler must free its hands before any empty-handed work. A load with
  // no sink in reach leaves it standing, which is no work taken. A porter with room in its cart fills it
  // from the same good close by before the trip home.
  if (load !== undefined && load.amount > 0) {
    if (!planCartTopUp(plan, load)) planDelivery(plan, pass.spacing, load);
    if (world.has(e, MoveGoal) || world.has(e, CurrentAtomic)) noteWorkTaken(world, e);
    return;
  }

  // A worker posted or flagged beyond its signpost reach takes up no work until the network reaches the
  // post. Owner ruling: no confined trade (`confinedJob` in the signpost network names the free ones)
  // walks past its signposts for a player; a computer seat's is led back by `guideLostSettler`. A load
  // still goes to its bound sink above, so it is never stranded in hand.
  if (strandedPost(world, ctx, terrain, e, plan.limit) !== null) {
    standIdle(plan, pass, settler, hx, hy, alert);
    return;
  }

  if (planTrade(plan, pass, hx, hy)) {
    noteWorkTaken(world, e);
    return;
  }
  standIdle(plan, pass, settler, hx, hy, alert);
}

/** The trade rungs proper, most-specific-first; true when one took the settler. */
function planTrade(plan: PlannerContext, pass: PlannerPass, hx: number, hy: number): boolean {
  const { world, ctx, entity: e } = plan;

  // The field loop sits above the producer rung so a farm that also carries an abstract recipe (real
  // extracted content synthesizes one from `logicproduction`) farms its fields instead of standing
  // at the station minting the good.
  if (planFarmer(plan, pass.farmClaims, pass.idle)) return true;

  // The breeder's own cycle, above the producer rung: breeding is one branch of it, and the herd work
  // around it is nothing a recipe workshop's loop would do.
  if (planBreeder(plan, pass.seatClaims, pass.spacing, pass.idle)) return true;

  // A worker bound to a recipe workshop: a carrier ferries, a craftsman produces. A gatherer bound there
  // is not its operator - it runs the gather rung below and banks its harvest into the building, so it
  // is excluded here rather than routed into the craft loop.
  const workplace =
    jobCanHarvest(ctx, plan.jobType) || isFisherJob(ctx.content, plan.jobType)
      ? null
      : boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
  if (workplace !== null) {
    if (isCarrierJob(ctx, plan.jobType)) {
      planWorkshopSupplier(plan, workplace, pass.seatClaims, pass.spacing, pass.idle);
    } else {
      planProducer(plan, workplace, pass.seatClaims, pass.spacing, pass.idle);
    }
    return true;
  }

  if (planBuilder(plan, pass.spacing, pass.constructionClaims, pass.repairCrews, pass.siteSupply, pass.idle))
    return true;

  if (planSiteStaff(plan, pass.spacing, hx, hy)) return true;

  if (planFisher(plan)) return true;
  if (planGatherer(plan, pass.harvestClaims, pass.idle)) return true;
  if (planPorter(plan, pass.idle)) return true;
  if (planWaitAtFieldFlag(plan, pass.idle)) return true;

  // A settler the haul rung also refuses is genuinely idle. One already chatting keeps its chat, and one
  // a script pinned stays where it is; a graduate heads back to its school's yard, and the rest step off a
  // shared tile first so an idle crowd spreads out, then chat with a nearby idle neighbour.
  return planCarrierHaul(plan, pass.anyHaulable);
}

/** The ladder's idle tail: the settler stands, its lost mark is reconciled on the cut-off cadence, and it
 *  idles in place, by its school or among neighbours. */
function standIdle(
  plan: PlannerContext,
  pass: PlannerPass,
  settler: SettlerView,
  hx: number,
  hy: number,
  alert: () => boolean,
): void {
  const { world, ctx, terrain, entity: e } = plan;
  pass.idle.stand(e, true);
  if (cutOffCheckDue(ctx, plan.owner) && checkCutOff(pass, plan)) return;
  if (world.has(e, Chat) || staysPut(world, e)) return;
  // A lost settler stands where its note sends the player, so it is found there; it only chats in place.
  const lost = world.has(e, LostWay);
  if (!lost && planGraduateWait(world, ctx, terrain, e, plan.here, pass.spacing, plan.limit)) return;
  if (!lost && stepOffHomeDoor(world, ctx, terrain, e, plan.here, pass.spacing)) return;
  if (lost || deStackIdle(world, terrain, e, hx, hy, pass.spacing) === null) {
    planGossipIdle(
      world,
      ctx,
      e,
      settler,
      hx,
      hy,
      pass.gossipCandidates,
      idleReplanPeriodOf(world, e),
      alert,
    );
  }
}

/** The standing idler's cut-off check: reconcile its lost mark, a builder's sites included, and lead a lost
 *  computer settler back. Returns whether it set that walk. */
export function checkCutOff(pass: PlannerPass, plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: e } = plan;
  reconcileCutOff(world, ctx, terrain, e, plan.jobType, plan.limit, pass.seatDoors, () =>
    jobCanBuild(ctx.content, plan.jobType)
      ? builderWorkBeyondReach(plan, pass.spacing, pass.constructionClaims, pass.siteSupply)
      : null,
  );
  return guideLostSettler(pass, e, plan.limit);
}

/** Stand `e` through its idle beats when it waits inside `building` with no clip of its own running. */
function standIfInside(pass: PlannerPass, e: Entity, building: Entity): void {
  if (isInside(pass.world, e, building) && !pass.world.has(e, CurrentAtomic)) pass.idle.stand(e, false);
}

/** A script may pin a settler where it was left: it still works, shelters and answers its needs, but
 *  takes none of the rungs whose only purpose is to drift (`MISSIONS.md`, behaviour bit 1). */
function staysPut(world: World, e: Entity): boolean {
  return hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.STAYS_PUT);
}
