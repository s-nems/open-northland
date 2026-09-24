import {
  Carrying,
  Chat,
  Engagement,
  Female,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  ownerOf,
  Position,
  type SettlerView,
  Stance,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { holdsGround } from '../../conflict/battle-alert.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { planWomanHoard } from '../../family/hoard.js';
import { planChildWander } from '../../family/wander.js';
import { isFisherJob, MILITARY_MODE } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { planGossipIdle, planGossipSeek } from '../../social/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { planTrader } from '../../trade/index.js';
import { anotherSystemOwns } from '../action-owner.js';
import { stepOut } from '../indoors.js';
import type { PlannerContext } from '../planner/context.js';
import type { PlannerPass } from '../planner/pass.js';
import { combatOwnsFeet } from '../planner/replan.js';
import { boundWorkplaceTarget } from '../targets/index.js';
import { planHomeTopUp } from './at-home.js';
import { reconcileCutOff } from './cut-off.js';
import {
  planBuilder,
  planCarrierHaul,
  planDelivery,
  planFisher,
  planGatherer,
  planPorter,
  planProducer,
  planSiteStaff,
  planWorkshopSupplier,
} from './economy/index.js';
import { planEquipOrder } from './equip-order.js';
import { planFarmer } from './farming/index.js';
import { planBreeder } from './husbandry/index.js';
import { answerNeedInPlace, orderedNeed, planNeeds } from './needs.js';
import { planShelter } from './shelter.js';
import { isSleepingAtHome } from './sleep-at-home.js';
import { deStackIdle, stepOffHomeDoor } from './spacing.js';
import { holdsPostThroughNeed, planTowerPost } from './tower-post.js';
import { planTraining } from './training.js';

// The drive ladder: pick the next atomic for one idle settler. Each drive returns `true` when it takes
// the settler for the tick, and the rung order is a behavior contract the state goldens cover.

/**
 * Plan a growing settler: shelter first, else a stroll. It carries no needs of its own (approximation, see
 * `lifecycle/needs/system.ts`), so no needs rung runs for it. It still runs for cover like anyone else,
 * though it never mans the walls (`defence/manning.ts`).
 */
export function planChild(pass: PlannerPass, e: Entity, settler: SettlerView): void {
  const { world, ctx, terrain } = pass;
  if (pass.shelters.size > 0) {
    const p = world.get(e, Position);
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (planShelter(world, ctx, terrain, e, settler, here, hereNode, limit, pass.shelters)) return;
  }
  if (staysPut(world, e)) return;
  planChildWander(world, ctx, terrain, e, pass.spacing);
}

/** Plan one idle adult. `jobType` is the caller's non-null narrowing of `settler.jobType`. */
export function planAdult(pass: PlannerPass, e: Entity, settler: SettlerView, jobType: number): void {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  const load = world.tryGet(e, Carrying);
  const limit = navigationLimitFor(world, ctx.content, terrain, e);

  // The alarm outranks every other drive: hunger, the ownership gate, and a live equip errand alike.
  if (planShelter(world, ctx, terrain, e, settler, here, hereNode, limit, pass.shelters)) return;

  // A pressing need on a fighting unit is answered from what it carries or what its post holds, never by
  // walking to food, a bed or a temple and never by lying down. Under the alarm, which still outranks
  // combat. Departure: the manual gives the need rule no combat exemption and carves a soldier out only for
  // sleeping at home, so leaving an unprovisioned fighter to go without is a deliberate choice. A need the
  // player ordered is the exception: the fight is broken off for it and the full ladder below runs, so
  // ordering a meal is how a player feeds an army that would otherwise starve in the line.
  if (combatOwnsFeet(world, e)) {
    if (orderedNeed(world, e) === undefined) {
      answerNeedInPlace(world, ctx, e, settler);
      return;
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
    planGossipSeek(world, ctx, e, settler, hereNode.hx, hereNode.hy, pass.gossipCandidates, true)
  ) {
    return;
  }

  // Already home for one need: top the others up before stepping back out, rather than walking the whole
  // errand again for each bar.
  if (planHomeTopUp(world, ctx, e, settler)) return;

  // The battle alert: a rear rank neither lies down nor wanders off while the front rank fights. Asked at
  // most once per settler per tick, and only by a rung whose answer it changes, which each rung does after
  // its own cheap refusals - the presence sweep behind it is the pass's one expensive read.
  let alerted: boolean | undefined;
  const alert = (): boolean => (alerted ??= holdsGround(world, ctx, e, pass.front));
  if (planNeeds(world, ctx, terrain, e, settler, here, load, pass.targets, limit, pass.spacing, alert)) {
    // A needs drive pulled the settler away, so it is no longer inside whatever it was waiting in -
    // unless it is the bed the sleep rung just put it in, or a garrison that served its need on the
    // spot and is still holding the tower.
    if (!isSleepingAtHome(world, e) && !holdsPostThroughNeed(world, e)) stepOut(world, e);
    return;
  }

  // Ownership gate, below the needs drives on purpose: hunger, fatigue and piety are soft overrides that
  // still pull the unit away, so a marrying or child-making settler still eats. Engagement is the one
  // member that never gets here, having been answered in place above.
  if (anotherSystemOwns(world, e)) return;
  // BARRACKS DRILL: a player errand outranking the settler's trade for as long as it lasts, and above the
  // equip errand below because the drill ends in a profession change.
  if (planTraining(world, ctx, terrain, e, settler, here, limit)) return;
  // EQUIP ERRAND: a player order outranking the DEFEND hold below, socialising and every economy rung,
  // but under the needs drives and the ownership gate. A DEFEND guard walks the errand and re-holds its
  // unchanged anchor afterwards, since the combat walk-back pass defers to a live errand.
  if (planEquipOrder(world, ctx, terrain, e, settler, here, limit, pass.targets)) return;
  // TOWER WATCH: above the DEFEND hold below because it is the more specific standing order - a posted
  // archer whose stance is also DEFEND must still walk to his tower rather than freeze on the spot.
  if (planTowerPost(world, ctx, terrain, e, jobType, here)) return;
  // DEFEND hold: a guard keeps its post against the company and economy rungs, and the CombatSystem walks
  // it back when displaced. Below the equip errand on purpose: the one player order a guard still runs
  // without dropping its stance.
  if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) return;
  // The company rung: a lonely settler leaves its work to find a partner, above the economy rungs on
  // purpose - the "worker downs tools to socialize" beat. Nobody walks off to chat while a battle is on
  // nearby: the fighting trades never reach this rung at all (`social/gossip/plan.ts` bars them), so the
  // alert passed down holds the civilian trade a player or a script put into a fighting stance. Its work
  // is left alone - the alert governs rest and company, not a settler's trade.
  if (
    !staysPut(world, e) &&
    planGossipSeek(world, ctx, e, settler, hereNode.hx, hereNode.hy, pass.gossipCandidates, false, alert)
  ) {
    return;
  }
  // The housewife rung: a woman takes no trade - her work is stocking the family larder. Above the
  // carry-delivery rung so food she lifted for the pantry goes home, not to the nearest store.
  if (
    world.has(e, Female) &&
    planWomanHoard(world, ctx, terrain, e, pass.externalFood, pass.externalQuality, limit)
  )
    return;

  const plan: PlannerContext = {
    world,
    ctx,
    terrain,
    entity: e,
    tribe: settler.tribe,
    jobType,
    experience: settler.experience,
    owner: ownerOf(world, e),
    here,
    targets: pass.targets,
    inbound: pass.inbound,
    limit,
    gossipCandidates: pass.gossipCandidates,
  };
  planEconomy(plan, pass, settler, load, hereNode.hx, hereNode.hy, alert);
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

  // Deliver a carried load first: a settler must free its hands before any empty-handed work.
  if (load !== undefined && load.amount > 0) {
    planDelivery(plan, load);
    return;
  }

  // A trader works its route above every workplace rung: its houses are its own binding, and it
  // never operates a craft. With no route to work it falls through to the idle rungs.
  if (planTrader(plan)) return;

  // The field loop sits above the producer rung so a farm that also carries an abstract recipe (real
  // extracted content synthesizes one from `logicproduction`) farms its fields instead of standing
  // at the station minting the good.
  if (planFarmer(plan, pass.farmClaims)) return;

  // The breeder's own cycle, above the producer rung: breeding is one branch of it, and the herd work
  // around it is nothing a recipe workshop's loop would do.
  if (planBreeder(plan, pass.seatClaims, pass.spacing)) return;

  // A worker bound to a recipe workshop: a carrier ferries, a craftsman produces. A gatherer bound there
  // is not its operator - it runs the gather rung below and banks its harvest into the building, so it
  // is excluded here rather than routed into the craft loop.
  const workplace =
    jobCanHarvest(ctx, plan.jobType) || isFisherJob(ctx.content, plan.jobType)
      ? null
      : boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
  if (workplace !== null) {
    if (isCarrierJob(ctx, plan.jobType)) {
      planWorkshopSupplier(plan, workplace, pass.seatClaims, pass.spacing);
    } else {
      planProducer(plan, workplace, pass.seatClaims, pass.spacing);
    }
    return;
  }

  if (planBuilder(plan, pass.spacing, pass.constructionClaims)) return;

  if (planSiteStaff(plan, pass.spacing, hx, hy)) return;

  if (planFisher(plan)) return;
  if (planGatherer(plan, pass.harvestClaims)) return;
  if (planPorter(plan)) return;

  // A settler the haul rung also refuses is genuinely idle. One already chatting keeps its chat, and one
  // a script pinned stays where it is; the rest step off a shared tile first so an idle crowd spreads
  // out, then chat with a nearby idle neighbour.
  if (planCarrierHaul(plan, pass.anyHaulable)) return;
  pass.standing.add(e);
  reconcileCutOff(plan, pass.seatDoors);
  if (world.has(e, Chat) || staysPut(world, e)) return;
  if (stepOffHomeDoor(world, ctx, terrain, e, plan.here, pass.spacing)) return;
  if (!deStackIdle(world, terrain, e, hx, hy, pass.spacing)) {
    planGossipIdle(world, ctx, e, settler, hx, hy, pass.gossipCandidates, alert);
  }
}

/** A script may pin a settler where it was left: it still works, shelters and answers its needs, but
 *  takes none of the rungs whose only purpose is to drift (`MISSIONS.md`, behaviour bit 1). */
function staysPut(world: World, e: Entity): boolean {
  return hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.STAYS_PUT);
}
