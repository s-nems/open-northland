import { Building, JobAssignment, Position, Stockpile } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { farmedGoodOf, sowsFieldsAt } from '../../../economy/fields.js';
import { bankedSlot, isStorageBuildingType } from '../../../stores/index.js';

/**
 * Whether `home` is a farm whose output this settler hauls out to storage: a field producer whose
 * carrier, not field worker, this settler is. Shared by the pickup and delivery-routing sides, which
 * must agree or a carrier lifts a farm's output and then cannot route it. A farmer banks its reaped crop
 * into the farm; only the carrier clears it to central storage.
 */
export function isFarmCarrierHaulOutRole(
  world: World,
  ctx: SystemContext,
  home: Entity,
  jobType: number,
): boolean {
  const building = world.tryGet(home, Building);
  return (
    building !== undefined &&
    farmedGoodOf(ctx.content, building.buildingType) !== null &&
    !sowsFieldsAt(ctx.content, jobType, building.buildingType)
  );
}

/** Whether a settler is posted to a storage fixture rather than to a producing workplace. */
export function isBoundToStorageSink(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  return binding !== undefined && isStorageSink(world, ctx, binding.workplace);
}

/** A positioned stockpile that accepts general deliveries rather than running a recipe or filling itself. */
export function isStorageSink(world: World, ctx: SystemContext, store: Entity): boolean {
  if (!world.has(store, Stockpile) || !world.has(store, Position)) return false;
  const building = world.tryGet(store, Building);
  return building === undefined || isStorageBuildingType(ctx.content, building.buildingType);
}

/** Whether a store has capacity for another unit of the requested good, judged on the banked slot the
 *  deposit would land in, so the bound-store rungs see the same sink `pileupIntoStore` does. */
export function hasRoom(world: World, ctx: SystemContext, store: Entity, goodType: number): boolean {
  const slot = bankedSlot(world, ctx, store, goodType);
  return (world.get(store, Stockpile).amounts.get(slot.goodType) ?? 0) < slot.capacity;
}
