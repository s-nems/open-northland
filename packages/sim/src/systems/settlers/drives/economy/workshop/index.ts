import { CARRY_CAPACITY, Owner } from '../../../../../components/index.js';
import { mergeRecipes } from '../../../../../core/content-index/production.js';
import type { Entity } from '../../../../../ecs/world.js';
import { shelfBlockedOutput } from '../../../../economy/production.js';
import { planGossipIdle } from '../../../../social/index.js';
import { isWorkplaceOperator, mergedRecipeOf, recipesByProductOf } from '../../../../stores/index.js';
import { atOrWalk, startDraw, startPickup } from '../../../atomics/start.js';
import { enterBuilding } from '../../../indoors.js';
import type { PlannerContext } from '../../../planner/context.js';
import type { PlannerSpacing } from '../../../planner/spacing.js';
import { interactionCell } from '../../../targets/index.js';
import { unreachableGoalVeto } from '../../../unreachable-goals.js';
import { loiterCell } from '../../spacing.js';
import { deliverableGoodProbe } from '../delivery-targets.js';
import { startCraftAtomic } from './craft.js';
import {
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

export type WorkSeatClaims = Map<Entity, WorkSeats>;

/**
 * Run the self-service producer loop: claim an available batch seat, ship the good whose full slot stopped
 * the workshop, fetch a missing input, haul an output out, then loiter by the door with nothing left to do.
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
): void {
  const { world, ctx, here, targets } = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const own = operatorRecipes(world, ctx, workplace, plan.entity);
  let seats = seatClaims.get(workplace);
  if (seats === undefined) {
    seats = { claimed: 0, performing: 0 };
    seatClaims.set(workplace, seats);
  }
  if (seats.claimed < workSeatCount(world, ctx, workplace, own)) {
    seats.claimed += 1;
    holdInsideWorkplace(plan, workplace, seats);
    return;
  }

  // A full output slot is the one stall no fetch can clear, so shipping that good outranks the next input
  // trip and happens whether or not a carrier is bound to the workshop.
  const blocked = shelfBlockedOutput(world, ctx, workplace);
  if (blocked !== null && deliverableGoodProbe(plan)(blocked)) {
    startOutputHaul(plan, workplace, blocked);
    return;
  }

  // Supply reads the operator's own recipe rotation, so a coin-pinned minter fetches for its own ware
  // first; an operator that has earned no product here keeps the whole-shop view.
  const supply = own.length === 0 ? recipe : mergeRecipes(own);

  const source = nearestMissingInputSource(
    targets.bands,
    world,
    ctx,
    here,
    workplace,
    supply,
    plan.owner,
    false,
    plan.limit ?? undefined,
    unreachableGoalVeto(world, ctx, plan.entity),
  );
  if (source !== null) {
    routeToInputSource(plan, source);
    return;
  }

  // A craftsman with no seat and no input to fetch carries its own output out, since the workshop's
  // carrier also serves the settlement and may not return before the output stock fills.
  if (haulWorkplaceOutput(plan, workplace)) return;
  // A craftsman without a seat adds no production at the door, so it may loiter beside it.
  loiterByDoor(plan, workplace, spacing, false);
}

/**
 * Ferry inputs and outputs for a carrier bound to a recipe workplace. Input slots are topped up before
 * output is removed so the operators do not starve; that priority is the existing named approximation.
 */
export function planWorkshopSupplier(plan: PlannerContext, workplace: Entity, spacing: PlannerSpacing): void {
  const { world, ctx, here, targets } = plan;
  const worker = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const restockToCapacity = true;
  const source = nearestMissingInputSource(
    targets.bands,
    world,
    ctx,
    here,
    workplace,
    recipe,
    plan.owner,
    restockToCapacity,
    plan.limit ?? undefined,
    unreachableGoalVeto(world, ctx, plan.entity),
  );
  if (source !== null) {
    routeToInputSource(plan, source);
    return;
  }

  if (haulWorkplaceOutput(plan, workplace)) return;
  // A carrier that is itself the workplace's operator keeps standing on the door so the production
  // presence gate still fires; one at a workshop run by other operators drives nothing and may loiter.
  loiterByDoor(plan, workplace, spacing, isWorkplaceOperator(world, ctx, workplace, worker.jobType));
}

/**
 * Send the worker to a chosen input source: a fetch lifts one carry-load out of a store, a draw cranks a
 * shared utility in place for one unit. A trip carries a single unit whoever makes it, craftsman or bound
 * carrier: the original reserves exactly one against both ends of the walk before it sets off
 * (+1 at the work house, -1 at the source), so a recipe wanting two of a good is two walks.
 */
function routeToInputSource(plan: PlannerContext, source: MissingInputSource): void {
  const { world, ctx, terrain, entity, here } = plan;
  const worker = plan;
  if (source.kind === 'fetch') {
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, CARRY_CAPACITY),
    );
    return;
  }
  // A draw runs the utility recipe's own `ticks`, its work time for one unit.
  const ticks = recipesByProductOf(world, ctx, source.utility)?.get(source.goodType)?.ticks ?? 1;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.utility, here), () =>
    startDraw(world, ctx, entity, source.goodType, source.utility, ticks),
  );
}

/**
 * Stand on the workplace's door and step inside; that door presence is what drives the production gate.
 * An operator that arrives takes the next indoor seat's craft clip, which is what the render draws it
 * performing. Without `seats` - an idle shop, or an unowned fixture's carrier - it waits inside with
 * nothing to show.
 */
function holdInsideWorkplace(plan: PlannerContext, workplace: Entity, seats?: WorkSeats): void {
  const { world, ctx, terrain, entity, here } = plan;
  enterBuilding(world, entity, workplace, here, interactionCell(world, ctx, terrain, workplace, here), () => {
    if (seats === undefined) return;
    startCraftAtomic(world, ctx, entity, workplace, seats.performing);
    seats.performing += 1;
  });
}

/**
 * Loiter beside the workplace door rather than on it, so a bound worker with nothing to do neither runs
 * the craft nor hides indoors, and may strike up an idle chat with a nearby idler. One that drives the
 * craft by its presence (the well's or hive's carrier) stands on the door in view, where the operator
 * gate counts it and the next unit is lifted from. Unowned fixtures keep the wait-inside behaviour so
 * their state hashes stay byte-identical.
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
  const stand = loiterCell(world, terrain, entity, here, door, spacing);
  atOrWalk(world, entity, here, stand, () => {
    const { x, y } = terrain.coordsOf(here);
    planGossipIdle(world, ctx, entity, plan, x, y, plan.gossipCandidates);
  });
}

/** Lift one carry-load of `output` out of the workplace; the delivery rung routes it to a store. */
function startOutputHaul(plan: PlannerContext, workplace: Entity, output: number): void {
  const { world, ctx, terrain, entity, here } = plan;
  const worker = plan;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    startPickup(world, ctx, entity, worker, workplace, output, CARRY_CAPACITY),
  );
}

function haulWorkplaceOutput(plan: PlannerContext, workplace: Entity): boolean {
  const output = workplaceOutputToHaul(deliverableGoodProbe(plan), plan.world, plan.ctx, workplace);
  if (output === null) return false;
  startOutputHaul(plan, workplace, output);
  return true;
}
