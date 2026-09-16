import { Stockpile, setStockAmount, UnderConstruction, Upgrading } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * The ordinary goods inventory a store exposes to fetchers. An upgrade keeps that inventory live in
 * {@link Upgrading.savedStock}, while the entity's {@link Stockpile} is the separate construction hold.
 * A from-scratch site has no ordinary inventory.
 */
export function accessibleStockAmounts(world: World, store: Entity): ReadonlyMap<number, number> | undefined {
  const upgrading = world.tryGet(store, Upgrading);
  if (upgrading !== undefined) return upgrading.savedStock;
  if (world.has(store, UnderConstruction)) return undefined;
  return world.tryGet(store, Stockpile)?.amounts;
}

/** Write one good through {@link accessibleStockAmounts}' ownership seam. */
export function setAccessibleStockAmount(
  world: World,
  store: Entity,
  goodType: number,
  amount: number,
): void {
  const upgrading = world.tryMut(store, Upgrading);
  if (upgrading !== undefined) {
    upgrading.savedStock.set(goodType, amount);
    return;
  }
  setStockAmount(world, store, goodType, amount);
}
