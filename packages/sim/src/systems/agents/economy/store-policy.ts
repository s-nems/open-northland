import { Building, Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { farmWorkGood } from '../../economy/farming.js';
import { mergedRecipeOf, stockCapacity } from '../../stores/index.js';
import { jobAtomics } from '../targets/index.js';

/** Whether a job is the field worker, rather than the carrier, of a farm building. */
function isFieldWorkerOf(world: World, ctx: SystemContext, building: Entity, jobType: number): boolean {
  const spec = farmWorkGood(world, ctx, building);
  return spec !== null && jobAtomics(ctx, jobType).has(spec.plantAtomic);
}

/**
 * Whether `home` is a farm whose OUTPUT this settler hauls OUT to storage: the building is a field
 * producer of `tribe` (it carries a `farming` good — {@link farmWorkGood}) and the settler is its
 * CARRIER, not its field worker. The shared role gate of the farm haul-out twins — the pickup side
 * (`boundProducerOutputToHaul`) and the delivery-routing side (`deliveryTargetFor` case 3), which must
 * agree or a carrier lifts a farm's output and then can't route it. A farmer banks its reaped crop INTO
 * the farm; only the carrier clears it to central storage.
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

/** A positioned stockpile that accepts general deliveries rather than running a recipe. */
export function isStorageSink(world: World, ctx: SystemContext, store: Entity): boolean {
  return (
    world.has(store, Stockpile) &&
    world.has(store, Position) &&
    mergedRecipeOf(world, ctx, store) === undefined
  );
}

/** Whether a store has capacity for another unit of the requested good. */
export function hasRoom(world: World, ctx: SystemContext, store: Entity, goodType: number): boolean {
  const have = world.get(store, Stockpile).amounts.get(goodType) ?? 0;
  return have < stockCapacity(world, ctx, store, goodType);
}
