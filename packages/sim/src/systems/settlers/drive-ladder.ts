import {
  Carrying,
  Female,
  JobAssignment,
  ownerOf,
  Position,
  Resting,
  type Settler,
  Stance,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { jobCanHarvest } from '../economy/flags.js';
import { planWomanHoard } from '../family/hoard.js';
import { planChildWander } from '../family/wander.js';
import { isChild } from '../lifecycle/ageclass.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { planGossipIdle, planGossipSeek } from '../social/index.js';
import { isCarrierJob } from '../stores/index.js';
import { deStackIdle } from './destack.js';
import { anyNeedPressing, planNeeds } from './drives-needs.js';
import {
  planBuilder,
  planCarrierHaul,
  planDelivery,
  planGatherer,
  planPorter,
  planProducer,
  planWorkshopSupplier,
} from './economy/index.js';
import { planEquipOrder } from './equip-order.js';
import { planFarmer } from './farming/index.js';
import type { PlannerContext } from './planner-context.js';
import type { PlannerPass } from './planner-pass.js';
import { anotherSystemOwns } from './replan.js';
import { isSleepingAtHome } from './sleep-at-home.js';
import { boundWorkplaceTarget } from './targets/index.js';

// The drive ladder: pick the next atomic for one idle settler, in this fixed priority order (each
// drive returns `true` when it takes the settler for the tick):
//
//   needs (eat > sleep > pray) → the ownership gate → the company (chat-seek) rung → the housewife
//   hoard → deliver a carried load → bound-farmer field loop → bound-producer / workshop-supplier
//   loop → build → gather (chop/collect) → porter ferrying → store-carrier haul → idle de-stack →
//   idle chat.
//
// The order is part of the design (and of the goldens): needs sit above the ownership gate so a
// starving combatant still feeds (a soft override), and the economy rungs go most-specific-first so
// a gatherer works its own trade before ferrying others' goods. The atomic id and its duration come
// from content, not code (the drives resolve them through the tribe's `setatomic` binding — see
// ./actions.ts); "utility" is minimal (nearest reachable target by Manhattan distance). Targets are
// scanned in canonical (ascending entity-id) order with a deterministic distance+cell tie-break, so
// the choice never depends on store insertion history.

type SettlerState = NonNullable<(typeof Settler)['__value']>;

/**
 * Plan a growing settler. A baby/child is a non-working life stage: it never runs economy/combat
 * work — it grows up (GrowthSystem) and potters around its home ({@link planChildWander}). A CHILD
 * runs the needs ladder first — the original binds child_female/child_male eat (10) and sleep (8)
 * animations (`setatomic 3/4` → `..._child_*_eat_slot_food`/`..._sleep`), so a hungry child seeks
 * food like an adult instead of growing up starved. A BABY is cared for and doesn't self-feed (the
 * original binds it no eat animation), so only the stroll runs.
 */
export function planChild(pass: PlannerPass, e: Entity, settler: SettlerState): void {
  const { world, ctx, terrain } = pass;
  if (isChild(settler.jobType) && anyNeedPressing(settler)) {
    const p = world.get(e, Position);
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    const load = world.tryGet(e, Carrying);
    if (planNeeds(world, ctx, terrain, e, settler, here, load, pass.targets, limit, pass.spacing)) {
      return;
    }
  }
  planChildWander(world, ctx, terrain, e, pass.spacing);
}

/**
 * Plan one idle adult. The person-level rungs run first (needs, the ownership gate, company, the
 * housewife hoard); an adult none of them takes falls to the trade ladder ({@link planEconomy}).
 * `jobType` is the caller's non-null narrowing of `settler.jobType`.
 */
export function planAdult(pass: PlannerPass, e: Entity, settler: SettlerState, jobType: number): void {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const hereNode = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  const load = world.tryGet(e, Carrying);
  // The settler's signpost confinement (or null when unlimited) — computed once, shared by the needs
  // drives here and the economy PlannerContext below.
  const limit = navigationLimitFor(world, ctx.content, terrain, e);

  if (planNeeds(world, ctx, terrain, e, settler, here, load, pass.targets, limit, pass.spacing)) {
    // A needs drive pulled the settler away: shed a lingering waiting-inside marker so the walk to
    // food/temple/a bed is visible (the render hides a Resting settler) and the family stages stop
    // reading a foraging parent as "inside". The sleep rung is the one drive that stamps Resting
    // itself — a settler that just got into its own bed keeps it (see isSleepingAtHome).
    if (!isSleepingAtHome(world, e)) world.remove(e, Resting);
    return;
  }

  // Ownership gate (see anotherSystemOwns for the per-marker owners). Sits below the needs drives on
  // purpose (soft overrides: hunger/fatigue/piety still pull the unit away, and a marrying/child-making
  // settler still eats, faithful to the autonomous-settler model).
  if (anotherSystemOwns(world, e)) return;
  // EQUIP ERRAND: a live player equip order outranks the DEFEND hold below, socialising and every
  // economy rung (the player sent the settler for gear), but sits under the needs drives and the
  // ownership gate above, like the other soft overrides. A DEFEND guard walks the errand and re-holds
  // its unchanged anchor afterwards (the combat walk-back pass defers to the errand, see
  // returnToAnchor). See ./equip-order.ts.
  if (planEquipOrder(world, ctx, terrain, e, settler, here, limit, pass.targets)) return;
  // DEFEND hold: a guard keeps its post against the company and economy rungs (the CombatSystem walks
  // it back when displaced); owned-only, so unowned/golden fixtures are untouched. Below the equip
  // errand on purpose: the one player order a guard still runs without dropping its stance.
  if (world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND) return;
  // The company rung: a lonely settler (deficit at the seek threshold) leaves its work to find a
  // partner — above the economy rungs on purpose, the "worker downs tools to socialize" beat
  // (see ../social/gossip/).
  if (planGossipSeek(world, ctx, e, settler, hereNode.hx, hereNode.hy, pass.gossipCandidates)) {
    return;
  }
  // The housewife rung: a woman takes no trade — her work is stocking the family larder (hoarding,
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
  // there (a collector employed to feed a smith its ore) is not its operator — it runs the gather
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

  // A settler whose bound workplace is a construction site — a running upgrade — stands down instead
  // of running the remaining trade rungs: its trade needs the finished workhouse. Readable source:
  // `jobtypes.ini` `mustHaveFinishedWorkHouseFlag`, per-job data collapsed to a blanket here — every
  // bound trade we model sets 1, the 0 rows (hunter/scout/jester) have no bound-workplace rung, and
  // the farm/producer rungs above already apply the gate per-rung. Sits below planBuilder (a builder
  // bound to an upgrading building must still build); the binding survives, so work resumes the tick
  // the upgrade completes.
  const boundWorkplace = world.tryGet(e, JobAssignment)?.workplace;
  if (boundWorkplace !== undefined && world.has(boundWorkplace, UnderConstruction)) {
    deStackIdle(world, terrain, e, hx, hy, pass.spacing);
    return;
  }

  if (planGatherer(plan, pass.harvestClaims)) return;
  if (planPorter(plan)) return;

  // A settler the haul rung also refuses is genuinely idle: step off a shared tile first so an idle
  // crowd spreads out (./destack.ts), then chat with a nearby idle neighbour (../social/gossip/).
  if (!planCarrierHaul(plan, pass.anyHaulable)) {
    if (!deStackIdle(world, terrain, e, hx, hy, pass.spacing)) {
      planGossipIdle(world, ctx, e, settler, hx, hy, pass.gossipCandidates);
    }
  }
}
