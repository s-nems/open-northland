import { Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { farmWorkGood } from '../../economy/farming.js';
import { recipeOf, stockCapacity } from '../../stores/index.js';
import { jobAtomics } from '../targets/index.js';

/** Whether a job is the field worker, rather than the carrier, of a farm building. */
export function isFieldWorkerOf(
  world: World,
  ctx: SystemContext,
  building: Entity,
  jobType: number,
): boolean {
  const spec = farmWorkGood(world, ctx, building);
  return spec !== null && jobAtomics(ctx, jobType).has(spec.plantAtomic);
}

/** A positioned stockpile that accepts general deliveries rather than running a recipe. */
export function isStorageSink(world: World, ctx: SystemContext, store: Entity): boolean {
  return (
    world.has(store, Stockpile) && world.has(store, Position) && recipeOf(world, ctx, store) === undefined
  );
}

/** Whether a store has capacity for another unit of the requested good. */
export function hasRoom(world: World, ctx: SystemContext, store: Entity, goodType: number): boolean {
  const have = world.get(store, Stockpile).amounts.get(goodType) ?? 0;
  return have < stockCapacity(world, ctx, store, goodType);
}
