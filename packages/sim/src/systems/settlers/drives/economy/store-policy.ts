import { Building, JobAssignment, Position, Stockpile } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { farmWorkGood } from '../../../economy/fields.js';
import { bankedSlot, mergedRecipeOf } from '../../../stores/index.js';
import { jobAtomics } from '../../targets/index.js';

/** Whether a job is the field worker, rather than the carrier, of a farm building. */
function isFieldWorkerOf(world: World, ctx: SystemContext, building: Entity, jobType: number): boolean {
  const spec = farmWorkGood(world, ctx, building);
  return spec !== null && jobAtomics(ctx, jobType).has(spec.plantAtomic);
}

/**
 * Whether `home` is a farm whose output this settler hauls out to storage: a field producer of `tribe`
 * whose carrier, not field worker, this settler is. Shared by the pickup and delivery-routing sides, which
 * must agree or a carrier lifts a farm's output and then cannot route it. A farmer banks its reaped crop
 * into the farm; only the carrier clears it to central storage.
 */
export function isFarmCarrierHaulOutRole(
  world: World,
  ctx: SystemContext,
  home: Entity,
  jobType: number,
  tribe: number,
): boolean {
  return (
    world.tryGet(home, Building)?.tribe === tribe &&
    farmWorkGood(world, ctx, home) !== null &&
    !isFieldWorkerOf(world, ctx, home, jobType)
  );
}

/** Whether a settler is posted to a storage fixture rather than to a producing workplace. */
export function isBoundToStorageSink(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  return binding !== undefined && isStorageSink(world, ctx, binding.workplace);
}

/** A positioned stockpile that accepts general deliveries rather than running a recipe. */
export function isStorageSink(world: World, ctx: SystemContext, store: Entity): boolean {
  return (
    world.has(store, Stockpile) &&
    world.has(store, Position) &&
    mergedRecipeOf(world, ctx, store) === undefined
  );
}

/** Whether a store has capacity for another unit of the requested good, judged on the banked slot the
 *  deposit would land in, so the bound-store rungs see the same sink `pileupIntoStore` does. */
export function hasRoom(world: World, ctx: SystemContext, store: Entity, goodType: number): boolean {
  const slot = bankedSlot(world, ctx, store, goodType);
  return (world.get(store, Stockpile).amounts.get(slot.goodType) ?? 0) < slot.capacity;
}
