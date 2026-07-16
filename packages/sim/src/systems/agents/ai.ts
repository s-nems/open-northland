import {
  Age,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Fleeing,
  Owner,
  ownerOf,
  PathRequest,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  Stance,
  WorkFlag,
  YardDeliveryRoute,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { jobCanHarvest } from '../economy/flags.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { canonicalById, clearNavState, isTravelling, NodeBuckets } from '../spatial.js';
import { collectInboundSupply, isCarrierJob, releaseSupplyRun } from '../stores/index.js';
import { deStackIdle, type SpacingState } from './destack.js';
import { planNeeds } from './drives-needs.js';
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
import { collectFarmClaims, planFarmer, releaseFarmTask } from './farming/index.js';
import { navigationPlanner } from './navigation.js';
import type { PlannerContext } from './planner-context.js';
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
 * The split mirrors the original: the atomic vocabulary is the soul of the behavior, and navigation
 * is just how a settler physically reaches an atomic's target. The atomic planner runs first so a
 * freshly-set goal is picked up by the navigation pass in the same tick (no one-tick stall).
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
 *   needs (eat > sleep > pray) → combat/hold gates → deliver a carried load → bound-farmer field loop →
 *   bound-producer loop → gather (chop/collect) → porter ferrying → store-carrier haul → idle de-stack.
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
  // Build each target category once per tick (ascending entity-id, canonical), so a scan is
  // O(candidates) rather than every idle settler re-scanning and re-sorting the whole world per
  // `nearest*` call (`canonicalEntities()` allocates and sorts all entities — O(settlers · entities ·
  // log n) per tick). The ascending-id order matches a full scan, so the distance+id tie-break picks the
  // identical winner and the goldens hold.
  const targets = collectTargets(world, ctx, terrain);
  // Dormancy gate: the carrier fallback (`nearestWorkplaceOutput`) is a full stockpile scan per settler.
  // If nothing is haulable anywhere this tick, every settler's scan returns null — so decide it once and
  // let idle settlers skip the scan (identical outcome, no per-settler work). This is what keeps an idle
  // crowd at ~0 cost.
  const anyHaulable = hasHaulableOutput(world, ctx, targets.stockpiles);
  // Spacing occupancy — shared by both spacing consumers (the idle de-stack rung and the builder work
  // slots, see ./destack.ts): owned settlers currently stationary (not travelling — distinct from the
  // waiting-inside `Resting` marker) bucketed by integer tile, in ascending-id order. Gated on Owner so it
  // only ever moves player-owned units; the unowned golden/economy fixtures build an empty bucket set, so
  // their planner output is byte-identical. Built once from the tick-start positions, stable across the
  // loop's own mutations.
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

  // Canonical settler order: the per-tick claim maps (farmClaims, seatClaims) hand out targets/seats
  // first-come-first-served, so the visit order is a pick, not a mere sweep — it must be ascending
  // entity-id, never store insertion history. Today Settler stores happen to insert in id order (settlers
  // are never re-added), but nothing enforces that; the sort pins the winner.
  for (const e of canonicalById(world.query(Settler, Position))) {
    const routeLoad = world.tryGet(e, Carrying);
    const failedRequest = world.tryGet(e, PathRequest);
    const workFlag = world.tryGet(e, WorkFlag);
    const yardRoute = world.tryGet(e, YardDeliveryRoute);
    const validYardRoute =
      yardRoute !== undefined &&
      routeLoad !== undefined &&
      routeLoad.amount > 0 &&
      routeLoad.goodType === yardRoute.goodType &&
      workFlag !== undefined &&
      workFlag.flag === yardRoute.flag &&
      world.has(yardRoute.flag, DeliveryFlag);
    if (yardRoute !== undefined && !validYardRoute) world.remove(e, YardDeliveryRoute);
    if (
      validYardRoute &&
      yardRoute !== undefined &&
      !yardRoute.failed &&
      failedRequest?.failed === true &&
      failedRequest.goal === yardRoute.goal
    ) {
      yardRoute.failed = true;
      world.touch(e);
      clearNavState(world, e);
    }
    // Busy: an atomic is running, or the settler is en route to a target. Leave it to play out (its
    // FarmTask claim, if any, stays live so colleagues keep avoiding its target).
    if (world.has(e, CurrentAtomic)) continue;
    if (isTravelling(world, e)) continue;
    // Replanning from here: the settler's previous farm intent is spent/stale — release its claim so
    // it never blocks ITSELF from re-choosing (planFarmer re-stamps a fresh task if it takes over).
    releaseFarmTask(world, e, farmClaims);
    // Likewise its rest-inside marker: the drive re-stamps it within this same tick if there is still
    // nothing to do (so the render never sees a gap), and it stays off the moment real work appears.
    world.remove(e, Resting);
    // And its supply errand (SupplyRun): the fetch/delivery rungs re-stamp it below while the errand
    // lasts; a settler re-planning has, by definition, finished or abandoned the previous leg. Releasing
    // through the tally keeps the inbound count in lockstep with the store.
    releaseSupplyRun(world, e, inbound);

    const settler = world.get(e, Settler);
    if (settler.jobType === null) continue; // an unemployed settler has no job atomics to run
    // A baby/child is a non-working life stage: it runs no atomics and, faithful to the original (a baby
    // is cared for, it doesn't self-feed), does not run the adult needs-drives — it just grows up
    // (GrowthSystem). Key on the Age component, not `isNonWorkingAge(jobType)`: Age is present ⟺ the
    // settler is in a baby/child stage (the GrowthSystem invariant), and keying on it avoids a jobType-id
    // collision — the golden slice's woodcutter is jobType 1, the same number as `baby_female`, but only a
    // settler born young carries an Age.
    if (world.has(e, Age)) continue;

    const p = world.get(e, Position);
    const hereNode = nodeOfPosition(p.x, p.y);
    const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
    const load = routeLoad;

    // The settler's signpost confinement (or null when unlimited) — computed once, shared by the needs
    // drives here and the economy PlannerContext below.
    const limit = navigationLimitFor(world, terrain, e);

    // NEEDS (highest priority): eat > sleep > pray. An unsatisfiable need falls through to work.
    if (planNeeds(world, ctx, terrain, e, settler, here, load, targets, limit)) continue;

    // Combat / hold gates — a unit that combat or the player currently owns skips economy planning. All
    // four sit below the needs drives on purpose (soft overrides — hunger/fatigue/piety still pull the
    // unit away, faithful to the autonomous-settler model):
    //  - Engagement: fighting/advancing — the CombatSystem owns its movement (the chase) and its atomic
    //    (the swing); it clears the marker when the fight ends.
    //  - Fleeing: running from danger (the FLEE stance's active drive) — matters while it stands (boxed
    //    in, or in the flee cool-down); while running it carries a MoveGoal and was skipped above.
    //    combatSystem sheds the marker when the threat is gone; a collapsing need overrides the flee
    //    inside combatSystem, so this never traps a starving unit.
    //  - DEFEND stance: a guard holds its post against the economy (the CombatSystem walks it back when
    //    displaced); owned-only, so unowned/golden fixtures are untouched.
    //  - PlayerOrder: a unit still walking out the player's move order. playerOrderSystem removes the
    //    order on arrival, and the economy re-tasks it the same tick.
    if (world.has(e, Engagement)) continue;
    if (world.has(e, Fleeing)) continue;
    const stance = world.tryGet(e, Stance);
    if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) continue;
    if (world.has(e, PlayerOrder)) continue;

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

    // 2a. PRODUCER / WORKSHOP SUPPLIER — a worker bound to a recipe workshop. A CARRIER bound there
    // ferries (top up inputs, carry outputs out — it never operates the craft); a craftsman claims a
    // work seat and produces, fetches a missing input itself when starved (even beside a carrier),
    // and leaves the output run to its carrier when one is bound.
    // A gatherer bound to a recipe workshop (a collector employed to feed a smith its ore) is NOT its
    // operator — it runs the gather drive below and banks its harvest into the building. Excluded here so
    // boundWorkplaceTarget doesn't route it into the producer/supplier craft loop.
    const workplace = jobCanHarvest(ctx, plan.jobType)
      ? null
      : boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
    if (workplace !== null) {
      if (isCarrierJob(ctx, plan.jobType)) {
        planWorkshopSupplier(plan, workplace, spacing);
      } else {
        planProducer(plan, workplace, seatClaims, targets.carrierSuppliedWorkplaces.has(workplace), spacing);
      }
      continue;
    }

    // 2b. BUILD — a builder raises the nearest construction site of its tribe (hammer it, or fetch a
    // material it is short on); a non-builder passes through. `spacing` spreads a site's crew over
    // its yard (see ./destack.ts claimWorkCell).
    if (planBuilder(plan, spacing)) continue;

    // 3. HARVEST / COLLECT — a gatherer chops the nearest resource or collects the nearest trunk.
    if (planGatherer(plan)) continue;

    // 4. PORTER — a settler bound to a storage fixture ferries loose ground piles into it.
    if (planPorter(plan)) continue;

    // 5. STORE-CARRIER HAUL — an employed carrier (bound to a store's transport slot) ferries finished
    // workplace outputs to the stores. Hauling is a trade, not a default, so everyone else with nothing
    // above is genuinely idle: de-stack off a shared tile so an idle crowd spreads out (./destack.ts).
    if (!planCarrierHaul(plan, anyHaulable)) {
      deStackIdle(world, ctx, terrain, e, hereNode.hx, hereNode.hy, spacing);
    }
  }
}
