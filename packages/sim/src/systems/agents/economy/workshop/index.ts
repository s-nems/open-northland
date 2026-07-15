import { CARRY_CAPACITY, Resting } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { recipeOf } from '../../../stores/index.js';
import { atOrWalk, startPickup } from '../../actions.js';
import type { PlannerContext } from '../../planner-context.js';
import { interactionCell } from '../../targets/index.js';
import { nearestMissingInputSource, workplaceOutputToHaul, workSeatCount } from './supply.js';

/** Work seats already claimed at each workplace during the canonical planner sweep. */
export type WorkSeatClaims = Map<Entity, number>;

/**
 * Run the self-service producer loop: claim an available batch seat, fetch a missing input, haul an
 * output when no carrier owns that run, then wait inside. The ordering is observed original behavior;
 * exact trip scheduling is not decoded, so fetch-before-haul remains the existing named approximation.
 */
export function planProducer(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  carrierSupplied: boolean,
): void {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const claimed = seatClaims.get(workplace) ?? 0;
  if (claimed < workSeatCount(world, ctx, workplace, recipe)) {
    seatClaims.set(workplace, claimed + 1);
    holdInsideWorkplace(plan, workplace);
    return;
  }

  const source = nearestMissingInputSource(targets.stockpileCells, world, ctx, here, workplace, recipe);
  if (source !== null) {
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, source.amount),
    );
    return;
  }

  if (!carrierSupplied && haulWorkplaceOutput(plan, workplace, recipe)) return;
  holdInsideWorkplace(plan, workplace);
}

/**
 * Ferry inputs and outputs for a carrier bound to a recipe workplace. Input slots are topped up before
 * output is removed so the operators do not starve; that priority is the existing named approximation.
 */
export function planWorkshopSupplier(plan: PlannerContext, workplace: Entity): void {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const recipe = recipeOf(world, ctx, workplace);
  if (recipe === undefined) return;

  const restockToCapacity = true;
  const source = nearestMissingInputSource(
    targets.stockpileCells,
    world,
    ctx,
    here,
    workplace,
    recipe,
    restockToCapacity,
  );
  if (source !== null) {
    const batch = Math.min(source.amount, CARRY_CAPACITY);
    atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, source.store, here), () =>
      startPickup(world, ctx, entity, worker, source.store, source.goodType, batch),
    );
    return;
  }

  if (haulWorkplaceOutput(plan, workplace, recipe)) return;
  holdInsideWorkplace(plan, workplace);
}

function holdInsideWorkplace(plan: PlannerContext, workplace: Entity): void {
  const { world, ctx, terrain, entity, here } = plan;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    world.add(entity, Resting, { at: workplace }),
  );
}

function haulWorkplaceOutput(
  plan: PlannerContext,
  workplace: Entity,
  recipe: NonNullable<ReturnType<typeof recipeOf>>,
): boolean {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const worker = plan;
  const output = workplaceOutputToHaul(targets.sinks, world, workplace, recipe);
  if (output === null) return false;
  atOrWalk(world, entity, here, interactionCell(world, ctx, terrain, workplace, here), () =>
    startPickup(world, ctx, entity, worker, workplace, output, CARRY_CAPACITY),
  );
  return true;
}
