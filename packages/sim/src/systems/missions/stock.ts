import { BUILDING_KIND } from '@open-northland/data';
import { Stockpile, setStockAmount } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stockCapacity } from '../stores/index.js';

/** Whether a house of the type has a slot for `good` at all, finished or not. */
export function typeStoresGood(ctx: SystemContext, buildingType: number, good: number): boolean {
  return contentIndex(ctx.content).storedGoodsByBuilding.get(buildingType)?.has(good) ?? false;
}

/**
 * Whether `good` in a house of the type counts as its owner's stock: everything a storage, a home or a
 * tower shelves, but of a workplace only what it makes, never the inputs delivered to it. Reading: the
 * original's counts take a workplace's product slots and skip its input slots.
 */
export function countsAsOwnStock(ctx: SystemContext, buildingType: number, good: number): boolean {
  const index = contentIndex(ctx.content);
  const type = index.buildings.get(buildingType);
  if (type === undefined) return false;
  if (type.kind !== BUILDING_KIND.workplace) return typeStoresGood(ctx, buildingType, good);
  return (
    type.produces.includes(good) || (index.recipeByProductByBuilding.get(buildingType)?.has(good) ?? false)
  );
}

export function stockOf(world: World, e: Entity, good: number): number {
  return world.tryGet(e, Stockpile)?.amounts.get(good) ?? 0;
}

/** Add to a store's pile, over its capacity if that is where the amount lands: a script gift is not a
 *  delivery, and the original's stock write clamps nothing. */
export function addStock(world: World, e: Entity, good: number, amount: number): void {
  if (amount > 0) setStockAmount(world, e, good, stockOf(world, e, good) + amount);
}

/** Take up to `want` of `good` out of a store; returns how much came out. */
export function takeStock(world: World, e: Entity, good: number, want: number): number {
  const have = stockOf(world, e, good);
  const taken = Math.min(have, want);
  if (taken > 0) setStockAmount(world, e, good, have - taken);
  return taken;
}

/** How many more units of `good` the store takes before its slot is full; zero without the slot. */
export function roomFor(world: World, ctx: SystemContext, e: Entity, good: number): number {
  return Math.max(0, stockCapacity(world, ctx, e, good) - stockOf(world, e, good));
}
