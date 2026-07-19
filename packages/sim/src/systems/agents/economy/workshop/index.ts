import { CARRY_CAPACITY, Owner, Resting } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { planGossipIdle } from '../../../social/index.js';
import { isWorkplaceOperator, mergedRecipeOf } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../actions.js';
import { loiterCell, type SpacingState } from '../../destack.js';
import type { PlannerContext } from '../../planner-context.js';
import { interactionCell } from '../../targets/index.js';
import { deliverableGoodProbe } from '../routing.js';
import { nearestMissingInputSource, workplaceOutputToHaul, workSeatCount } from './supply.js';

/** Work seats already claimed at each workplace during the canonical planner sweep. */
export type WorkSeatClaims = Map<Entity, number>;

/**
 * Run the self-service producer loop: claim an available batch seat, fetch a missing input, haul an
 * output when no carrier owns that run, then loiter by the door when there is genuinely nothing to do.
 * The ordering is observed original behavior; exact trip scheduling is not decoded, so fetch-before-haul
 * remains the existing named approximation.
 */
export function planProducer(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  carrierSupplied: boolean,
  spacing: SpacingState,
): void {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const claimed = seatClaims.get(workplace) ?? 0;
  if (claimed < workSeatCount(world, ctx, workplace)) {
    seatClaims.set(workplace, claimed + 1);
    holdInsideWorkplace(plan, workplace);
    return;
  }

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
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, source.amount),
    );
    return;
  }

  if (!carrierSupplied && haulWorkplaceOutput(plan, workplace, recipe)) return;
  // A surplus/idle craftsman: its seat is taken (or the workshop can't produce), so its door presence adds
  // no production — it may loiter beside the door rather than stand on it.
  loiterByDoor(plan, workplace, spacing, false);
}

/**
 * Ferry inputs and outputs for a carrier bound to a recipe workplace. Input slots are topped up before
 * output is removed so the operators do not starve; that priority is the existing named approximation.
 */
export function planWorkshopSupplier(plan: PlannerContext, workplace: Entity, spacing: SpacingState): void {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

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
    const batch = Math.min(source.amount, CARRY_CAPACITY);
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, batch),
    );
    return;
  }

  if (haulWorkplaceOutput(plan, workplace, recipe)) return;
  // A carrier that is itself the workplace's operator (a well's lone carrier draws its water) must keep
  // standing ON the door so the ProductionSystem's presence gate still fires — it is never "bored". A
  // carrier at a workshop run by other operators (a mill's miller) drives nothing, so it may loiter beside.
  loiterByDoor(plan, workplace, spacing, isWorkplaceOperator(world, ctx, workplace, worker.jobType));
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

function haulWorkplaceOutput(
  plan: PlannerContext,
  workplace: Entity,
  recipe: NonNullable<ReturnType<typeof mergedRecipeOf>>,
): boolean {
  const { world, ctx, terrain, entity, here } = plan;
  const worker = plan;
  const output = workplaceOutputToHaul(deliverableGoodProbe(plan), world, workplace, recipe);
  if (output === null) return false;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    startPickup(world, ctx, entity, worker, workplace, output, CARRY_CAPACITY),
  );
  return true;
}
