import { Carrying, Female, ownerOf, Position, type SettlerState, Stance } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import { jobCanHarvest } from '../../economy/work-flag.js';
import { planWomanHoard } from '../../family/hoard.js';
import { planChildWander } from '../../family/wander.js';
import { isChild } from '../../lifecycle/ageclass.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { planGossipIdle, planGossipSeek } from '../../social/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { stepOut } from '../indoors.js';
import type { PlannerContext } from '../planner/context.js';
import type { PlannerPass } from '../planner/pass.js';
import { anotherSystemOwns } from '../planner/replan.js';
import { boundWorkplaceTarget } from '../targets/index.js';
import {
  planBuilder,
  planCarrierHaul,
  planDelivery,
  planGatherer,
  planPorter,
  planProducer,
  planSiteStaff,
  planWorkshopSupplier,
} from './economy/index.js';
import { planEquipOrder } from './equip-order.js';
import { planFarmer } from './farming/index.js';
import { anyNeedPressing, planNeeds } from './needs.js';
import { planShelter } from './shelter.js';
import { isSleepingAtHome } from './sleep-at-home.js';
import { deStackIdle } from './spacing.js';
import { holdsPostThroughNeed, planTowerPost } from './tower-post.js';
import { planTraining } from './training.js';

// The drive ladder: pick the next atomic for one idle settler. Each drive returns `true` when it takes
// the settler for the tick, and the rung order is a behavior contract the state goldens cover. Atomic
// ids and durations come from the tribe's `setatomic` bindings, never from code.

/**
 * Plan a growing settler: it never runs economy or combat work. A child runs the needs ladder first,
 * since the data binds child eat and sleep clips (`setatomic 3/4` on `..._child_*_eat_slot_food` and
 * `..._sleep`); a baby has no eat clip bound, so only the stroll runs for it.
 */
export function planChild(pass: PlannerPass, e: Entity, settler: SettlerState): void {
  const { world, ctx, terrain } = pass;
  // A child runs for cover like anyone else but never mans the walls (`defence/manning.ts`). The
  // shelter and needs rungs share this position and limit read, so it stays behind their gate.
  const needy = isChild(settler.jobType) && anyNeedPressing(settler);
  if (pass.shelters.size > 0 || needy) {
    const p = world.get(e, Position);
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (planShelter(world, ctx, terrain, e, settler, here, hereNode, limit, pass.shelters)) return;
    const load = world.tryGet(e, Carrying);
    if (needy && planNeeds(world, ctx, terrain, e, settler, here, load, pass.targets, limit, pass.spacing)) {
      return;
    }
  }
  planChildWander(world, ctx, terrain, e, pass.spacing);
}

/** Plan one idle adult. `jobType` is the caller's non-null narrowing of `settler.jobType`. */
export function planAdult(pass: PlannerPass, e: Entity, settler: SettlerState, jobType: number): void {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  const load = world.tryGet(e, Carrying);
  // The settler's signpost confinement, or null when unlimited.
  const limit = navigationLimitFor(world, ctx.content, terrain, e);

  // The alarm outranks every other drive: hunger, the ownership gate, and a live equip errand alike.
  if (planShelter(world, ctx, terrain, e, settler, here, hereNode, limit, pass.shelters)) return;

  if (planNeeds(world, ctx, terrain, e, settler, here, load, pass.targets, limit, pass.spacing)) {
    // A needs drive pulled the settler away, so it is no longer inside whatever it was waiting in
    // (../indoors.ts) - unless it is the bed the sleep rung just put it in, or a garrison that served
    // its need on the spot and is still holding the tower.
    if (!isSleepingAtHome(world, e) && !holdsPostThroughNeed(world, e)) stepOut(world, e);
    return;
  }

  // Ownership gate (see anotherSystemOwns for the per-marker owners). Sits below the needs drives on
  // purpose (soft overrides: hunger/fatigue/piety still pull the unit away, and a marrying/child-making
  // settler still eats, faithful to the autonomous-settler model).
  if (anotherSystemOwns(world, e)) return;
  // BARRACKS DRILL: the player sent this settler to be trained, so the errand outranks its trade for as
  // long as it lasts - the same soft-override tier as the equip errand below, and above it because the
  // drill ends in a profession change. See ./training.ts.
  if (planTraining(world, ctx, terrain, e, settler, here, limit)) return;
  // EQUIP ERRAND: a live player equip order outranks the DEFEND hold below, socialising and every
  // economy rung (the player sent the settler for gear), but sits under the needs drives and the
  // ownership gate above, like the other soft overrides. A DEFEND guard walks the errand and re-holds
  // its unchanged anchor afterwards (the combat walk-back pass defers to the errand, see
  // returnToAnchor). See ./equip-order.ts.
  if (planEquipOrder(world, ctx, terrain, e, settler, here, limit, pass.targets)) return;
  // TOWER WATCH: a fighter posted to a tower climbs it and holds it. Above the DEFEND hold below because
  // it is the more specific standing order - a posted archer whose stance is also DEFEND must still walk
  // to his tower rather than freeze on the spot. See ./tower-post.ts.
  if (planTowerPost(world, ctx, terrain, e, jobType, here)) return;
  // DEFEND hold: a guard keeps its post against the company and economy rungs (the CombatSystem walks
  // it back when displaced); owned-only, so unowned/golden fixtures are untouched. Below the equip
  // errand on purpose: the one player order a guard still runs without dropping its stance.
  if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) return;
  // The company rung: a lonely settler (deficit at the seek threshold) leaves its work to find a
  // partner - above the economy rungs on purpose, the "worker downs tools to socialize" beat
  // (see ../../social/gossip/).
  if (planGossipSeek(world, ctx, e, settler, hereNode.hx, hereNode.hy, pass.gossipCandidates)) {
    return;
  }
  // The housewife rung: a woman takes no trade - her work is stocking the family larder (hoarding,
  // see planWomanHoard). Above the carry-delivery rung so food she lifted for the pantry goes HOME,
  // not to the nearest store.
  if (world.has(e, Female) && planWomanHoard(world, ctx, terrain, e, pass.externalFood, limit)) return;

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
  planEconomy(plan, pass, settler, load, hereNode.hx, hereNode.hy);
}

/**
 * The trade (economy) ladder for an employed adult, most-specific-first; each rung is documented at
 * its drive. `hx`/`hy` are the settler's half-cell node coordinates, for the drives that read them
 * raw (de-stack, idle chat).
 */
function planEconomy(
  plan: PlannerContext,
  pass: PlannerPass,
  settler: SettlerState,
  load: { goodType: number; amount: number } | undefined,
  hx: number,
  hy: number,
): void {
  const { world, ctx, terrain, entity: e } = plan;

  // Deliver a carried load first: a settler must free its hands before any empty-handed work.
  if (load !== undefined && load.amount > 0) {
    planDelivery(plan, load);
    return;
  }

  // The field loop sits ABOVE the producer rung so a farm that also carries an abstract recipe (real
  // extracted content synthesizes one from `logicproduction`) farms its fields instead of standing
  // at the station minting the good.
  if (planFarmer(plan, pass.farmClaims)) return;

  // A worker bound to a recipe workshop: a carrier ferries, a craftsman produces. A gatherer bound
  // there (a collector employed to feed a smith its ore) is not its operator - it runs the gather
  // drive below and banks its harvest into the building, so it is excluded here rather than routed
  // into the craft loop.
  const workplace = jobCanHarvest(ctx, plan.jobType)
    ? null
    : boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
  if (workplace !== null) {
    if (isCarrierJob(ctx, plan.jobType)) {
      planWorkshopSupplier(plan, workplace, pass.spacing);
    } else {
      planProducer(plan, workplace, pass.seatClaims, pass.spacing);
    }
    return;
  }

  if (planBuilder(plan, pass.spacing, pass.siteLeads)) return;

  // A settler posted to a workplace that is still going up - a fresh foundation or a running upgrade -
  // supplies it (a carrier) or waits at it (every other trade), rather than running the remaining trade
  // rungs.
  if (planSiteStaff(plan, pass.spacing, hx, hy)) return;

  if (planGatherer(plan, pass.harvestClaims)) return;
  if (planPorter(plan)) return;

  // A settler the haul rung also refuses is genuinely idle: step off a shared tile first so an idle
  // crowd spreads out (./spacing.ts), then chat with a nearby idle neighbour (../../social/gossip/).
  if (!planCarrierHaul(plan, pass.anyHaulable)) {
    if (!deStackIdle(world, terrain, e, hx, hy, pass.spacing)) {
      planGossipIdle(world, ctx, e, settler, hx, hy, pass.gossipCandidates);
    }
  }
}
