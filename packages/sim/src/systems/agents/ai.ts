import {
  Age,
  Carrying,
  Chat,
  Engagement,
  FamilyDuty,
  Female,
  Fleeing,
  JobAssignment,
  Owner,
  ownerOf,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  Stance,
  UnderConstruction,
  Wedding,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { jobCanHarvest } from '../economy/flags.js';
import { ExternalFoodIndex } from '../family/food-search.js';
import { planWomanHoard } from '../family/hoard.js';
import { planChildWander } from '../family/wander.js';
import { isChild } from '../lifecycle/ageclass.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { GossipCandidates, planGossipIdle, planGossipSeek } from '../social/index.js';
import { canonicalById, isTravelling, NodeBuckets } from '../spatial.js';
import { collectInboundSupply, isCarrierJob } from '../stores/index.js';
import { deStackIdle, type SpacingState } from './destack.js';
import { anyNeedPressing, planNeeds } from './drives-needs.js';
import { collectHarvestClaims } from './economy/harvest-claims.js';
import {
  planBuilder,
  planCarrierHaul,
  planDelivery,
  planGatherer,
  planPorter,
  planProducer,
  planWorkshopSupplier,
  type WorkSeatClaims,
} from './economy/index.js';
import { collectFarmClaims, planFarmer } from './farming/index.js';
import { navigationPlanner } from './navigation.js';
import type { PlannerContext } from './planner-context.js';
import { releaseStaleIntent } from './replan.js';
import { isSleepingAtHome } from './sleep-at-home.js';
import { boundWorkplaceTarget, collectTargets, hasHaulableOutput } from './targets/index.js';

/**
 * AISystem — the settler planner: two layered passes per tick.
 *
 *  1. {@link atomicPlanner} (the *what*): for an idle settler (a job, no atomic running, not
 *     travelling), run the drive ladder — needs (./drives-needs.ts), then the economy drives
 *     (`./economy`) — and either issue a MoveGoal to walk to the chosen target or start the
 *     CurrentAtomic the AtomicSystem will execute.
 *  2. {@link navigationPlanner} (the *where*, ./navigation.ts): turn a MoveGoal on a path-less,
 *     request-less entity into a PathRequest; PathfindingSystem routes it, MovementSystem walks it,
 *     and the goal is removed on arrival.
 *
 * The atomic planner runs first so a freshly-set goal is picked up by the navigation pass in the same
 * tick (no one-tick stall).
 */
export const aiSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to navigate over
  atomicPlanner(world, ctx, ctx.terrain);
  navigationPlanner(world, ctx.terrain);
};

/**
 * The atomic-utility planner: pick the next atomic for each idle settler by running the drive
 * ladder, in this fixed priority order (each drive returns `true` when it takes the settler for
 * this tick):
 *
 *   needs (eat > sleep > pray) → combat/hold gates → family/gossip fences + the company (chat-seek) rung →
 *   deliver a carried load → bound-farmer field loop → bound-producer loop → gather (chop/collect) →
 *   porter ferrying → store-carrier haul → idle chat → idle de-stack.
 *
 * The order is part of the design (and of the goldens): needs sit above the combat/hold gates so a
 * starving combatant still feeds (a soft override), and the economy rungs go most-specific-first so
 * a gatherer works its own trade before ferrying others' goods.
 *
 * The atomic id and its duration come from content, not code (the drives resolve them through the tribe's
 * `setatomic` binding — see ./actions.ts); "utility" is minimal (nearest reachable target by Manhattan
 * distance). Targets are scanned in canonical (ascending entity-id) order with a deterministic
 * distance+cell tie-break, so the choice never depends on store insertion history.
 */
function atomicPlanner(world: World, ctx: SystemContext, terrain: TerrainGraph): void {
  // Build each target category once per tick (ascending entity-id, canonical), so a scan is O(candidates)
  // rather than every idle settler re-scanning and re-sorting the whole world per `nearest*` call
  // (`canonicalEntities()` sorts all entities — O(settlers · entities · log n) per tick). The ascending-id
  // order matches a full scan, so the distance+id tie-break picks the identical winner.
  const targets = collectTargets(world, ctx, terrain);
  // Dormancy gate: the carrier fallback (`nearestWorkplaceOutput`) is a full stockpile scan per settler. If
  // nothing is haulable anywhere this tick every settler's scan returns null, so decide it once and let idle
  // settlers skip the scan (identical outcome, no per-settler work).
  const anyHaulable = hasHaulableOutput(world, ctx, targets.stockpiles);
  // One shared external-food index for every housewife's hoard rung this tick (it self-builds on the
  // first woman who actually needs a source, so a woman-less or fully-stocked tick pays nothing).
  const externalFood = new ExternalFoodIndex(world, ctx, terrain);
  // Spacing occupancy — shared by the idle de-stack rung and the builder work slots (./destack.ts): owned
  // settlers currently stationary (not travelling — distinct from the waiting-inside `Resting` marker)
  // bucketed by integer tile, in ascending-id order, built once from the tick-start positions so it is
  // stable across the loop's own mutations. Gated on Owner, so the unowned golden/economy fixtures build an
  // empty bucket set and their planner output stays byte-identical.
  const stationaryOwned = canonicalById(world.query(Settler, Position, Owner)).filter(
    (e) => !isTravelling(world, e),
  );
  const spacing: SpacingState = { occupancy: new NodeBuckets(world, stationaryOwned), claimed: new Set() };
  // Farm claims: every farmer still WALKING to or SWINGING at a field target (its live FarmTask) plus
  // the farmers planned earlier this tick reserve their nodes — so two farmers never shadow each other
  // to the same field/sheaf/sow spot, across ticks as well as within one (see `./farming`).
  const farmClaims = collectFarmClaims(world);
  // Work-seat claims: each workshop hands out one "stay & produce" seat per batch that would run if
  // staffed (see workSeatCount); operators planned earlier this tick take them first, so a surplus
  // operator goes fetching/hauling instead of idling inside beside a colleague's batch.
  const seatClaims: WorkSeatClaims = new Map();
  // Inbound-supply tally: units committed to each construction site by live SupplyRun errands, seeded
  // once and kept in lockstep as the pass releases/stamps runs (see InboundSupplyTally).
  const inbound = collectInboundSupply(world);
  // Harvest claims: one digger per resource node at a time — nodes under a live harvest atomic plus the
  // picks made earlier this pass (see economy/harvest-claims.ts).
  const harvestClaims = collectHarvestClaims(world);
  // Gossip: the lazy chat-candidate buckets (built only when a settler actually looks for a partner).
  const gossipCandidates = new GossipCandidates(world);

  // Canonical settler order: the per-tick claim maps (farmClaims, seatClaims) hand out targets/seats
  // first-come-first-served, so the visit order is a pick, not a mere sweep — it must be ascending
  // entity-id, never store insertion history. Today Settler stores happen to insert in id order (settlers
  // are never re-added), but nothing enforces that; the sort pins the winner.
  for (const e of canonicalById(world.query(Settler, Position))) {
    // Busy (an atomic running, a live route, a parked failed one) — leave it to play out; else the settler
    // is re-planning, and every intent the previous one left is shed first (see ./replan.ts).
    if (!releaseStaleIntent(world, ctx, e, farmClaims, inbound)) continue;

    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // A baby/child is a non-working life stage: it never runs economy/combat work — it grows up
    // (GrowthSystem) and potters around its home (planChildWander). A BABY is cared for and doesn't
    // self-feed (the original binds it no eat animation); a CHILD runs the needs ladder first — the
    // original binds child_female/child_male eat (10) and sleep (8) animations (`setatomic 3/4` →
    // `..._child_*_eat_slot_food`/`..._sleep`), so a hungry child seeks food like an adult instead of
    // growing up starved. (The ladder's pray rung is unreachable for a child: piety climbs only via
    // chargeMilitaryPiety on smiths.) The anyNeedPressing pre-gate keeps a sated child free — the
    // node/limit setup would otherwise cost a signpost scan per child per tick of provably-null work.
    // Key on the Age component, not `isNonWorkingAge(jobType)`: Age is present ⟺ the settler is in a
    // baby/child stage (the GrowthSystem invariant), and keying on it avoids a jobType-id collision —
    // the golden slice's woodcutter is jobType 1, the same number as `baby_female`, but only a settler
    // born young carries an Age.
    if (world.has(e, Age)) {
      if (isChild(settler.jobType) && anyNeedPressing(settler)) {
        const p = world.get(e, Position);
        const hereNode = nodeOfPosition(p.x, p.y);
        const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
        const limit = navigationLimitFor(world, terrain, e);
        const load = world.tryGet(e, Carrying);
        if (planNeeds(world, ctx, terrain, e, settler, here, load, targets, limit, spacing)) continue;
      }
      planChildWander(world, ctx, terrain, e, spacing);
      continue;
    }

    const p = world.get(e, Position);
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const load = world.tryGet(e, Carrying);

    // The settler's signpost confinement (or null when unlimited) — computed once, shared by the needs
    // drives here and the economy PlannerContext below.
    const limit = navigationLimitFor(world, terrain, e);

    // NEEDS (highest priority): eat > sleep > pray. An unsatisfiable need falls through to work.
    if (planNeeds(world, ctx, terrain, e, settler, here, load, targets, limit, spacing)) {
      // A needs drive pulled the settler away: shed a lingering waiting-inside marker so the walk to
      // food/temple/a bed is visible (the render hides a Resting settler) and the family stages stop
      // reading a foraging parent as "inside". The sleep rung is the one drive that stamps Resting
      // itself — a settler that just got into its own bed keeps it (see isSleepingAtHome).
      if (!isSleepingAtHome(world, e)) world.remove(e, Resting);
      continue;
    }

    // Combat / hold gates — a unit that combat or the player currently owns skips economy planning. All
    // four sit below the needs drives on purpose (soft overrides — hunger/fatigue/piety still pull the
    // unit away, faithful to the autonomous-settler model):
    //  - Engagement: fighting/advancing — the CombatSystem owns its movement (the chase) and its atomic
    //    (the swing); it clears the marker when the fight ends.
    //  - Fleeing: running from danger (the FLEE stance's active drive) — matters while it stands (boxed in,
    //    or in the flee cool-down); while running it carries a MoveGoal and was skipped above.
    //  - DEFEND stance: a guard holds its post against the economy (the CombatSystem walks it back when
    //    displaced); owned-only, so unowned/golden fixtures are untouched.
    //  - PlayerOrder: a unit still walking out the player's move order; playerOrderSystem removes the order
    //    on arrival, and the economy re-tasks it the same tick.
    if (world.has(e, Engagement)) continue;
    if (world.has(e, Fleeing)) continue;
    const stance = world.tryGet(e, Stance);
    if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) continue;
    if (world.has(e, PlayerOrder)) continue;
    // Family fences (below needs, like the gates above, so a marrying/child-making settler still eats):
    // the FamilySystem drives a settler mid-wedding or on family duty; the economy leaves it alone.
    if (world.has(e, Wedding)) continue;
    if (world.has(e, FamilyDuty)) continue;
    // Gossip fence + the company rung: a settler mid-chat is the GossipSystem's; a lonely one (deficit at
    // the seek threshold) leaves its work to find a partner — above the economy rungs on purpose, the
    // "worker downs tools to socialize" beat (see ../social/gossip/).
    if (world.has(e, Chat)) continue;
    if (planGossipSeek(world, ctx, e, settler, hereNode.hx, hereNode.hy, gossipCandidates)) {
      continue;
    }
    // The housewife rung: a woman takes no trade — her work is stocking the family larder (hoarding,
    // see planWomanHoard). Above the carry-delivery rung so food she lifted for the pantry goes HOME,
    // not to the nearest store.
    if (world.has(e, Female) && planWomanHoard(world, ctx, terrain, e, externalFood, limit)) continue;

    // The worker view of the settler — re-stated so `jobType`'s non-null narrowing carries into the
    // economy drives' signatures (the ladder skipped jobless settlers above).
    const plan: PlannerContext = {
      world,
      ctx,
      terrain,
      entity: e,
      tribe: settler.tribe,
      jobType: settler.jobType,
      experience: settler.experience,
      owner: ownerOf(world, e),
      here,
      targets,
      inbound,
      limit,
      gossipCandidates,
    };

    // 1. CARRYING — deliver first (a settler must free its hands before any empty-handed work).
    if (load !== undefined && load.amount > 0) {
      planDelivery(plan, load);
      continue;
    }

    // Empty-handed from here.

    // 2. FARMER — a worker bound to a FARM (a workplace producing a field-farmed good) runs the field
    // loop: reap ripe > carry sheaves home > sow > water > wait at the farm. Sits ABOVE the producer
    // rung so a farm that also carries an abstract recipe (real extracted content synthesizes one from
    // `logicproduction`) farms its fields instead of standing at the station minting the good.
    if (planFarmer(plan, farmClaims)) continue;

    // 2a. PRODUCER / WORKSHOP SUPPLIER — a worker bound to a recipe workshop. A carrier bound there ferries
    // (top up inputs, carry outputs out — it never operates the craft); a craftsman claims a work seat and
    // produces, fetches a missing input itself when starved (even beside a carrier), and leaves the output
    // run to its carrier when one is bound. A gatherer bound to a recipe workshop (a collector employed to
    // feed a smith its ore) is not its operator — it runs the gather drive below and banks its harvest into
    // the building, so it is excluded here rather than routed into the craft loop.
    const workplace = jobCanHarvest(ctx, plan.jobType)
      ? null
      : boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
    if (workplace !== null) {
      if (isCarrierJob(ctx, plan.jobType)) {
        planWorkshopSupplier(plan, workplace, spacing);
      } else {
        planProducer(plan, workplace, seatClaims, spacing);
      }
      continue;
    }

    // 2b. BUILD — a builder raises the nearest construction site of its tribe (hammer it, or fetch a
    // material it is short on); a non-builder passes through. `spacing` spreads a site's crew over
    // its construction perimeter (see ./destack.ts claimWorkCell).
    if (planBuilder(plan, spacing)) continue;

    // A settler whose bound workplace is a construction site — a running upgrade — stands down instead
    // of running the remaining work rungs: its trade needs the finished workhouse (readable source:
    // `jobtypes.ini` `mustHaveFinishedWorkHouseFlag`, per-job data collapsed to a blanket here — every
    // bound trade we model sets 1; the 0 rows (hunter/scout/jester) have no bound-workplace rung — the
    // gate the farm/producer rungs above already apply per-rung), so an upgrading warehouse's porter or a
    // workshop's bound gatherer/carrier waits
    // outside rather than ferrying for a sealed building. Sits below planBuilder (a builder bound to an
    // upgrading building must still build) and above the trade rungs; the binding survives, so work
    // resumes the tick the upgrade completes.
    const boundWorkplace = world.tryGet(e, JobAssignment)?.workplace;
    if (boundWorkplace !== undefined && world.has(boundWorkplace, UnderConstruction)) {
      deStackIdle(world, ctx, terrain, e, hereNode.hx, hereNode.hy, spacing);
      continue;
    }

    // 3. HARVEST / COLLECT — a gatherer chops the nearest FREE resource or collects the nearest trunk.
    if (planGatherer(plan, harvestClaims)) continue;

    // 4. PORTER — a settler bound to a storage fixture ferries loose ground piles into it.
    if (planPorter(plan)) continue;

    // 5. STORE-CARRIER HAUL — an employed carrier (bound to a store's transport slot) ferries finished
    // workplace outputs to the stores. Hauling is a trade, not a default, so everyone else with nothing
    // above is genuinely idle: step off a shared tile first so an idle crowd spreads out (./destack.ts),
    // then chat with a nearby idle neighbour (../social/gossip/).
    if (!planCarrierHaul(plan, anyHaulable)) {
      if (!deStackIdle(world, ctx, terrain, e, hereNode.hx, hereNode.hy, spacing)) {
        planGossipIdle(world, ctx, e, settler, hereNode.hx, hereNode.hy, gossipCandidates);
      }
    }
  }
}
