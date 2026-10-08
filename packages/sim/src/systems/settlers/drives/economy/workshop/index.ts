import type { Recipe } from '@open-northland/data';
import {
  CARRY_CAPACITY,
  CurrentAtomic,
  inPastimeChat,
  Owner,
  Production,
} from '../../../../../components/index.js';
import { mergeRecipes } from '../../../../../core/content-index/production.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import {
  outputRoomForCycles,
  shelfBlockedOutput,
  skipUnfundedRecipe,
} from '../../../../economy/production.js';
import { operatorRecipeEnabled } from '../../../../progression/index.js';
import { planGossipIdle } from '../../../../social/index.js';
import { assignedWorkers } from '../../../../stores/assigned-workers.js';
import { isWorkplaceOperator, mergedRecipeOf } from '../../../../stores/index.js';
import { type WorkshopWorkforce, workshopWorkforce } from '../../../../stores/workshop-workforce.js';
import { atOrWalk, walkFetchInput, walkPickupBatch } from '../../../atomics/start.js';
import { enterBuilding } from '../../../indoors.js';
import type { PlannerContext } from '../../../planner/context.js';
import type { IdleStands } from '../../../planner/idle-replan.js';
import type { PlannerSpacing } from '../../../planner/spacing.js';
import { interactionCell } from '../../../targets/index.js';
import { loiterCell } from '../../spacing.js';
import { deliverableGoodProbe } from '../delivery-targets.js';
import { haulFlagArea, waitAtHaulFlag } from '../haul-flag-area.js';
import { planVehicleYard } from '../vehicle-yard.js';
import { startCraftAtomic } from './craft.js';
import {
  type InputShortfall,
  type MissingInputSource,
  nearestMissingInputSource,
  operatorRecipes,
  workplaceOutputToHaul,
  workSeatCount,
} from './supply.js';

/**
 * One workplace's tally over the canonical planner sweep: seats handed out, and how many of their holders
 * already stand inside. Production advances one batch per operator present, so the indoor count - not the
 * claim order - is the index a craft clip may follow without freezing behind a claimant still walking.
 */
export interface WorkSeats {
  claimed: number;
  performing: number;
}

/** A supply errand stamped during this planner pass, after the pass's crew index was taken. */
interface PassErrand {
  readonly workplace: Entity;
  readonly goodType: number;
  readonly amount: number;
}

/** Per-planner-pass seat claims, crew recipes and inbound loads, indexed only when a workshop needs them. */
export class WorkSeatClaims {
  private readonly seats = new Map<Entity, WorkSeats>();
  private workforce: WorkshopWorkforce | undefined;
  private readonly recipesByWorkplace = new Map<Entity, Recipe[]>();
  private readonly errands = new Map<Entity, PassErrand>();
  /** Units the pass's errands bring, per workplace and good. */
  private readonly errandUnits = new Map<Entity, Map<number, number>>();
  /** The settler {@link inboundOf} asks for, read by the one skip filter the pass keeps. */
  private asker: Entity | undefined;
  private readonly skipsLoad = (settler: Entity): boolean =>
    settler === this.asker || this.errands.has(settler);

  /** `keepsSeat` says whether a crafter keeps its clip through this pass without being visited. */
  constructor(private readonly keepsSeat: (e: Entity) => boolean) {}

  /**
   * `workplace`'s tally this pass, counting first the crafters that keep their seats through it. They
   * re-plan together, on the workplace's shared beat, a batch change or the wake of one of them, so they
   * hold its first seats.
   */
  seatsAt(world: World, workplace: Entity): WorkSeats {
    let seats = this.seats.get(workplace);
    if (seats === undefined) {
      let kept = 0;
      for (const e of assignedWorkers(world, workplace)) {
        if (world.tryGet(e, CurrentAtomic)?.targetEntity === workplace && this.keepsSeat(e)) kept++;
      }
      seats = { claimed: kept, performing: kept };
      this.seats.set(workplace, seats);
    }
    return seats;
  }

  recipesFor(world: World, ctx: PlannerContext['ctx'], workplace: Entity): readonly Recipe[] {
    let recipes = this.recipesByWorkplace.get(workplace);
    if (recipes === undefined) {
      this.workforce ??= workshopWorkforce(world, ctx);
      const selected = new Set<Recipe>();
      for (const worker of this.workforce.operatorsAt(workplace)) {
        for (const recipe of operatorRecipes(world, ctx, workplace, worker)) selected.add(recipe);
      }
      recipes = [...selected];
      this.recipesByWorkplace.set(workplace, recipes);
    }
    return recipes;
  }

  /** Record `settler`'s errand stamped this pass; it replaces whatever the index held for that settler. */
  noteErrand(settler: Entity, errand: PassErrand): void {
    const replaced = this.errands.get(settler);
    if (replaced !== undefined) this.addErrandUnits(replaced, -replaced.amount);
    this.errands.set(settler, errand);
    this.addErrandUnits(errand, errand.amount);
  }

  /** Units other settlers are bringing to `workplace`: the index's live loads plus the errands stamped
   *  this pass, each settler counted once. The asker is re-planning, so its own indexed errand is gone. */
  inboundOf(plan: PlannerContext, workplace: Entity, goodType: number): number {
    this.workforce ??= workshopWorkforce(plan.world, plan.ctx);
    this.asker = plan.entity;
    const units = this.workforce.incomingOf(workplace, goodType, this.skipsLoad);
    return units + (this.errandUnits.get(workplace)?.get(goodType) ?? 0);
  }

  private addErrandUnits(errand: PassErrand, units: number): void {
    let byGood = this.errandUnits.get(errand.workplace);
    if (byGood === undefined) {
      byGood = new Map();
      this.errandUnits.set(errand.workplace, byGood);
    }
    byGood.set(errand.goodType, (byGood.get(errand.goodType) ?? 0) + units);
  }
}

/** An operator fetches against its own recipe amounts and a carrier restocks to capacity, neither counting
 *  the units other settlers are bringing: the original's producer fetches with no regard to them. */
const OWN_SHORTFALL: InputShortfall = { restockToCapacity: false };
const CARRIER_SHORTFALL: InputShortfall = { restockToCapacity: true };

/** A loitering worker is not idle to the planner, so its ladder runs every tick. */
const LOITER_PLAN_PERIOD_TICKS = 1;

/**
 * Run the self-service producer loop: advance running batches, supply open products, claim a new batch
 * seat, clear a full slot, haul an output out, then loiter by the door with nothing to do. Original
 * behavior: a producer fetches a missing input of its own recipe itself, whatever other settlers are
 * bringing, and never waits inside for them.
 *
 * Source basis: a workshop stopping on a full product slot and resuming once a unit leaves is observed
 * original behavior, and every craft trade carries `jobtypes.ini` `baseatomics 6`, which grants the
 * pickup/pileup atomics 22/23, so a craftsman may make its own trip. Trip scheduling is unknown, so the
 * rung order here, and sending out a craftsman whose ware the shelf cannot start, are approximations.
 */
export function planProducer(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  spacing: PlannerSpacing,
  idle?: IdleStands,
): void {
  const { world, ctx } = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  // A vehicle turn is worked outside on a yard site, so it comes before any seat is claimed.
  if (planVehicleYard(plan, workplace, spacing)) return;

  const own = operatorRecipes(world, ctx, workplace, plan.entity);
  const seats = seatClaims.seatsAt(world, workplace);
  const running = world.tryGet(workplace, Production)?.cycles.length ?? 0;
  if (seats.claimed < running) {
    seats.claimed += 1;
    holdInsideWorkplace(plan, workplace, seats, idle);
    return;
  }

  // A startable cheap recipe must not consume every unit while another open recipe of the crew waits for
  // more of that input, so a worker with no batch to advance brings a missing unit first, unless a
  // colleague already brings it. Approximation: this runs before the seat claim, so an operator whose
  // own recipe could start may fetch a colleague's.
  const crewShortfall: InputShortfall = {
    restockToCapacity: false,
    inbound: (good) => seatClaims.inboundOf(plan, workplace, good),
  };
  for (const candidate of seatClaims.recipesFor(world, ctx, workplace)) {
    if (!operatorRecipeEnabled(world, ctx, workplace, plan.entity, candidate)) continue;
    if (outputRoomForCycles(world, ctx, workplace, candidate) <= 0) continue;
    const source = nearestMissingInputSource(plan, workplace, candidate, crewShortfall);
    if (source !== null) {
      routeToInputSource(plan, workplace, source, seatClaims);
      return;
    }
  }

  skipUnfundedRecipe(world, ctx, workplace, plan.entity, own, crewShortfall.inbound);

  if (seats.claimed < workSeatCount(world, ctx, workplace, own)) {
    seats.claimed += 1;
    holdInsideWorkplace(plan, workplace, seats, idle);
    return;
  }

  // A full output slot still outranks topping up inputs for products that cannot currently be shelved.
  const blocked = shelfBlockedOutput(world, ctx, workplace);
  if (blocked !== null && deliverableGoodProbe(plan)(blocked)) {
    walkPickupBatch(plan, workplace, blocked);
    return;
  }

  // Supply reads the operator's own recipe rotation, so a coin-pinned minter fetches for its own ware
  // first; an operator that has earned no product here keeps the whole-shop view.
  const supply = own.length === 0 ? recipe : mergeRecipes(own);

  const source = nearestMissingInputSource(plan, workplace, supply, OWN_SHORTFALL);
  if (source !== null) {
    routeToInputSource(plan, workplace, source, seatClaims);
    return;
  }

  // A craftsman with no seat and no input to fetch carries its own output out, since the workshop's
  // carrier also serves the settlement and may not return before the output stock fills.
  if (haulWorkplaceOutput(plan, workplace)) return;
  // A craftsman without a seat adds no production at the door, so it may loiter beside it.
  loiterByDoor(plan, workplace, spacing, false);
}

/**
 * Ferry inputs and outputs for a carrier bound to a recipe workplace, or carry a self-filling house's
 * goods out. Input slots are topped up before output is removed so the operators do not starve; that
 * priority is the existing named approximation. A carrier holding a pickup flag takes a missing input
 * from the piles and stores around it before those elsewhere (owner ruling) and waits at the flag when idle.
 */
export function planWorkshopSupplier(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  spacing: PlannerSpacing,
): void {
  const { world, ctx } = plan;
  const worker = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  const area = haulFlagArea(plan);
  if (recipe !== undefined) {
    const source =
      (area === null ? null : nearestMissingInputSource(plan, workplace, recipe, CARRIER_SHORTFALL, area)) ??
      nearestMissingInputSource(plan, workplace, recipe, CARRIER_SHORTFALL);
    if (source !== null) {
      routeToInputSource(plan, workplace, source, seatClaims);
      return;
    }
  }

  if (haulWorkplaceOutput(plan, workplace)) return;
  // A carrier that is itself the workplace's operator keeps standing on the door so the production
  // presence gate still fires; one at a workshop run by other operators, or at a house that fills
  // itself, drives nothing and may loiter.
  const drivesProduction = recipe !== undefined && isWorkplaceOperator(world, ctx, workplace, worker.jobType);
  if (area !== null && !drivesProduction) waitAtHaulFlag(plan, area);
  else loiterByDoor(plan, workplace, spacing, drivesProduction);
}

/**
 * Send the worker to lift one carry-load of a missing input out of `source`'s store. A trip carries a
 * single unit whoever makes it, craftsman or bound carrier: the original reserves exactly one against both
 * ends of the walk before it sets off (+1 at the work house, -1 at the source), so a recipe wanting two of
 * a good is two walks. The search keeps choosing the nearest self-filling house even empty, so the worker
 * waits by its door for the refill ({@link walkFetchInput}).
 */
function routeToInputSource(
  plan: PlannerContext,
  workplace: Entity,
  source: MissingInputSource,
  seatClaims: WorkSeatClaims,
): void {
  const { entity, supply } = plan;
  supply.stampSupplyRun(entity, { site: workplace, goodType: source.goodType, amount: CARRY_CAPACITY });
  seatClaims.noteErrand(entity, { workplace, goodType: source.goodType, amount: CARRY_CAPACITY });
  walkFetchInput(plan, source.store, source.goodType, source.refills);
}

/**
 * Stand on the workplace's door and step inside; that door presence is what drives the production gate.
 * An operator that arrives takes the next indoor seat's craft clip, which is what the render draws it
 * performing. Without `seats` - an idle shop, or an unowned fixture's carrier - it waits inside with
 * nothing to show. With `idle` it keeps that wait through its idle beats.
 */
function holdInsideWorkplace(
  plan: PlannerContext,
  workplace: Entity,
  seats?: WorkSeats,
  idle?: IdleStands,
): void {
  const { world, ctx, terrain, entity, here } = plan;
  enterBuilding(world, entity, workplace, here, interactionCell(world, ctx, terrain, workplace, here), () => {
    idle?.stand(entity, false);
    if (seats === undefined) return;
    startCraftAtomic(world, ctx, entity, workplace, seats.performing);
    seats.performing += 1;
  });
}

/**
 * Loiter beside the workplace door rather than on it, so a bound worker with nothing to do neither runs
 * the craft nor hides indoors, and may strike up an idle chat with a nearby idler. One that drives the
 * craft by its presence stands on the door in view, where the operator gate counts it. Unowned fixtures
 * keep the wait-inside behaviour so their state hashes stay byte-identical.
 */
function loiterByDoor(
  plan: PlannerContext,
  workplace: Entity,
  spacing: PlannerSpacing,
  drivesProduction: boolean,
): void {
  const { world, ctx, terrain, entity, here } = plan;
  if (!world.has(entity, Owner)) {
    holdInsideWorkplace(plan, workplace);
    return;
  }
  const door = interactionCell(world, ctx, terrain, workplace, here);
  if (drivesProduction) {
    atOrWalk(world, entity, here, door, () => {});
    return;
  }
  // A pastime chat is as idle as loitering, so one it walked off to join is not cut short by the walk back.
  if (inPastimeChat(world, entity)) return;
  const stand = loiterCell(world, terrain, entity, here, door, spacing);
  atOrWalk(world, entity, here, stand, () => {
    const { x, y } = terrain.coordsOf(here);
    planGossipIdle(world, ctx, entity, plan, x, y, plan.gossipCandidates, LOITER_PLAN_PERIOD_TICKS);
  });
}

/** Lift one carry-load of an output out of the workplace, claimed; the delivery rung routes it to a store. */
function haulWorkplaceOutput(plan: PlannerContext, workplace: Entity): boolean {
  const output = workplaceOutputToHaul(
    deliverableGoodProbe(plan),
    plan.world,
    plan.ctx,
    plan.supply,
    workplace,
  );
  if (output === null) return false;
  walkPickupBatch(plan, workplace, output);
  return true;
}
