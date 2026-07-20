import { CARRY_CAPACITY, Owner, Resting } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { shelfBlockedOutput } from '../../../economy/production.js';
import { planGossipIdle } from '../../../social/index.js';
import { isWorkplaceOperator, mergedRecipeOf, recipesByProductOf } from '../../../stores/index.js';
import { atOrWalk, startDraw, startPickup } from '../../actions.js';
import { loiterCell, type SpacingState } from '../../destack.js';
import type { PlannerContext } from '../../planner-context.js';
import { interactionCell } from '../../targets/index.js';
import { deliverableGoodProbe } from '../routing.js';
import {
  type MissingInputSource,
  nearestMissingInputSource,
  workplaceOutputToHaul,
  workSeatCount,
} from './supply.js';

/** Work seats already claimed at each workplace during the canonical planner sweep. */
export type WorkSeatClaims = Map<Entity, number>;

/**
 * Run the self-service producer loop: claim an available batch seat, ship the good whose full slot stopped
 * the workshop, fetch a missing input, haul an output out, then loiter by the door with nothing left to do.
 *
 * Source basis: that a workshop stops on a full product slot and resumes once a unit leaves is observed
 * original behavior. That the CRAFTSMAN makes the trip is the approximation — `jobtypes.ini` grants the
 * pickup/pileup atomics to the carrier trades, not to a baker, so the original likely leaves the run to
 * the workshop's bound carrier. The self-service model predates this rung; see
 * docs/tickets/sim/workshop-carrier-unblocks-full-output.md. Trip scheduling is not decoded either, so
 * fetch-before-haul for a workshop that is merely idle (rather than blocked) stays a named approximation.
 */
export function planProducer(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  spacing: SpacingState,
): void {
  const { world, ctx, terrain, here, targets } = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const claimed = seatClaims.get(workplace) ?? 0;
  if (claimed < workSeatCount(world, ctx, workplace)) {
    seatClaims.set(workplace, claimed + 1);
    holdInsideWorkplace(plan, workplace);
    return;
  }

  // A full output slot is the one stall no fetch can clear, so shipping that good outranks the next input
  // trip and happens whether or not a carrier is bound to the workshop.
  const blocked = shelfBlockedOutput(world, ctx, workplace);
  if (blocked !== null && deliverableGoodProbe(plan)(blocked)) {
    startOutputHaul(plan, workplace, blocked);
    return;
  }

  // The nearest source of a missing input — a store that holds it (fetch) OR a shared utility that mints
  // it (draw, e.g. cranking the well for water), whichever is closer.
  const source = nearestMissingInputSource(
    targets.stockpileCells,
    world,
    ctx,
    terrain,
    here,
    workplace,
    recipe,
    false,
    plan.limit ?? undefined,
  );
  if (source !== null) {
    routeToInputSource(plan, source, false);
    return;
  }

  // A craftsman with no seat and no input to fetch has nothing left to do here, so it carries its own
  // output out even when the workshop staffs a carrier. Waiting for that carrier is what wedged a
  // flour-starved bakery: the carrier plans for its workshop only now and then (it is the settlement's
  // porter too), so a bakery whose shelf filled while the mill was dry drained at a handful of loaves per
  // twenty thousand ticks and otherwise stood idle with a full shelf. The workshop's own carrier still
  // does the same run from its own drive; this rung just stops the craftsman waiting on it.
  if (haulWorkplaceOutput(plan, workplace, recipe)) return;
  // A surplus/idle craftsman: its seat is taken (or the workshop can't produce), so its door presence adds
  // no production — it may loiter beside the door rather than stand on it.
  loiterByDoor(plan, workplace, spacing, false);
}

/**
 * Ferry inputs and outputs for a carrier bound to a recipe workplace. Input slots are topped up before
 * output is removed so the operators do not starve; that priority is the existing named approximation.
 */
export function planWorkshopSupplier(plan: PlannerContext, workplace: Entity, spacing: SpacingState): void {
  const { world, ctx, terrain, here, targets } = plan;
  const worker = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  // The carrier tops the input slots toward CAPACITY, from the nearest source of each — a store (fetch)
  // or a shared utility it cranks itself (draw), whichever is closer — before hauling output out.
  const restockToCapacity = true;
  const source = nearestMissingInputSource(
    targets.stockpileCells,
    world,
    ctx,
    terrain,
    here,
    workplace,
    recipe,
    restockToCapacity,
    plan.limit ?? undefined,
  );
  if (source !== null) {
    routeToInputSource(plan, source, true);
    return;
  }

  if (haulWorkplaceOutput(plan, workplace, recipe)) return;
  // A carrier that is itself the workplace's operator (a well's lone carrier draws its water) must keep
  // standing ON the door so the ProductionSystem's presence gate still fires — it is never "bored". A
  // carrier at a workshop run by other operators (a mill's miller) drives nothing, so it may loiter beside.
  loiterByDoor(plan, workplace, spacing, isWorkplaceOperator(world, ctx, workplace, worker.jobType));
}

/**
 * Send the worker to a chosen input source ({@link nearestMissingInputSource}): FETCH lifts the good out of
 * a store, DRAW cranks a shared utility in place for one unit. The loaded worker is then routed home by the
 * delivery rung (a fetched/drawn input goes to its bound workshop). `capFetchToCarry` limits a fetch to one
 * carry-load (the bound carrier's per-trip cap); a craftsman fetches the exact shortfall.
 */
function routeToInputSource(
  plan: PlannerContext,
  source: MissingInputSource,
  capFetchToCarry: boolean,
): void {
  const { world, ctx, terrain, entity, here } = plan;
  const worker = plan;
  if (source.kind === 'fetch') {
    const amount = capFetchToCarry ? Math.min(source.amount, CARRY_CAPACITY) : source.amount;
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, amount),
    );
    return;
  }
  // A draw runs the utility recipe's own `ticks` (its work time to extract one unit).
  const ticks = recipesByProductOf(world, ctx, source.utility)?.get(source.goodType)?.ticks ?? 1;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.utility, here), () =>
    startDraw(world, entity, source.goodType, source.utility, ticks),
  );
}

/** Stand ON the workplace's door and step inside — an operator holding a work seat (it drives the
 *  ProductionSystem's presence gate, and the render hides a {@link Resting} settler as "gone in"). */
function holdInsideWorkplace(plan: PlannerContext, workplace: Entity): void {
  const { world, ctx, terrain, entity, here } = plan;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    world.add(entity, Resting, { at: workplace }),
  );
}

/** Loiter visibly BESIDE the workplace door — a player-owned bound worker with nothing to do this tick
 *  (no seat, no input to fetch, no output to haul). Unlike {@link holdInsideWorkplace} it never stands on
 *  the door (so it neither runs the craft nor hides indoors) and never stamps {@link Resting}: the settler
 *  waits in the default standing pose next to its workplace, the user-directed "bored by the door" look.
 *  Once in place it may strike up an idle chat with a nearby fellow idler (the bottom-rung gossip — bored
 *  crews chatter at their doors; the Chat fence hands it back the moment real work reappears).
 *  Unowned economy/golden fixtures keep the original wait-inside behaviour (walk to the door, stamp
 *  {@link Resting}) so their state hashes stay byte-identical — the loiter spread is a player-facing polish,
 *  and only owned units carry the {@link Owner} the spacing machinery gates on. */
function loiterByDoor(
  plan: PlannerContext,
  workplace: Entity,
  spacing: SpacingState,
  drivesProduction: boolean,
): void {
  const { world, ctx, terrain, entity, here } = plan;
  if (!world.has(entity, Owner) || drivesProduction) {
    holdInsideWorkplace(plan, workplace);
    return;
  }
  const door = interactionCell(world, ctx, terrain, workplace, here);
  const stand = loiterCell(world, ctx, terrain, entity, here, door, spacing);
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

function haulWorkplaceOutput(
  plan: PlannerContext,
  workplace: Entity,
  recipe: NonNullable<ReturnType<typeof mergedRecipeOf>>,
): boolean {
  const output = workplaceOutputToHaul(deliverableGoodProbe(plan), plan.world, workplace, recipe);
  if (output === null) return false;
  startOutputHaul(plan, workplace, output);
  return true;
}
