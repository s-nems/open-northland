import type { Fixed } from '../../core/fixed.js';
import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/** The top rung of the longest upgrade chain content declares (`home level 00..04`). Content owns
 *  the real bound through `upgradeTarget`; a longer chain in content must move this with it. */
export const MAX_BUILDING_LEVEL = 4;

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building', 'economy');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the building type.
 * Never iterate this Map for a game decision - raw Map iteration is insertion-order and so
 * history-dependent; use {@link stockpileEntries}. The one tolerated raw read is an order-free fold
 * such as a min over entries.
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile', 'economy');

/** Canonical ascending-goodType view of a stockpile - the only order a game decision may read. */
export function stockpileEntries(s: { amounts: ReadonlyMap<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

/** One line of a goods cost - the `{ goodType, amount }` shape recipe inputs, construction materials,
 *  and upgrade costs all share. */
export type GoodsLine = { readonly goodType: number; readonly amount: number };

/** Whether `amounts` holds every line of `cost` in full: a missing good counts as 0, and an absent
 *  stockpile holds nothing. The gate to check before consuming a cost. */
export function holdsAll(
  amounts: ReadonlyMap<number, number> | undefined,
  cost: readonly GoodsLine[],
): boolean {
  for (const line of cost) {
    if ((amounts?.get(line.goodType) ?? 0) < line.amount) return false;
  }
  return true;
}

/**
 * Write one good's amount into `store`'s live stockpile. Every in-place write to an already-added
 * {@link Stockpile} goes through here - a bare `amounts.set` reaches no change channel. Only
 * creation-time writes before `world.add` may stay raw, since the add itself logs those.
 */
export function setStockAmount(world: World, store: Entity, goodType: number, amount: number): void {
  world.mut(store, Stockpile).amounts.set(goodType, amount);
}

/** Subtract every line of `cost` from `store`'s stockpile in place. The caller must have verified
 *  {@link holdsAll} first, so no count goes negative; a good that hits zero is left as a 0 entry. */
export function consumeGoods(world: World, store: Entity, cost: readonly GoodsLine[]): void {
  const amounts = world.get(store, Stockpile).amounts;
  for (const line of cost) {
    setStockAmount(world, store, line.goodType, (amounts.get(line.goodType) ?? 0) - line.amount);
  }
}

/**
 * Marks a {@link Building} that is a construction site - a placed foundation that already collides while
 * builders carry material and hammer it up. It rides on the plain `Building + Stockpile` shape, whose
 * stockpile is the delivered-material hold, and is removed the instant construction finishes.
 *
 * `labor` is builder-work progress in 0..ONE, distinct from delivered material: the visible
 * `Building.built` is `min(labor, deliveredFraction)`, so a site rises only as fast as both the hammering
 * and the arriving material allow.
 *
 * The site-then-build flow and the material cost (`construction`, extracted `LogicConstructionGoods`) are
 * faithful; the builder-driven pace is an approximation, since the original offers no oracle for
 * construction speed.
 */
export const UnderConstruction = defineComponent<{ labor: Fixed }>('UnderConstruction', 'economy');

/**
 * Marks a {@link Building} being upgraded into its type's `upgradeTarget` level. It rides beside
 * {@link UnderConstruction} - the upgrade re-opens the building as a construction site, dropping `built`
 * to 0 - and its presence switches the site's bill to the target tier's own `construction`, the level
 * difference rather than the cumulative from-scratch bill.
 *
 * The become-a-site-again flow, the separate build store, the difference-only cost, and the kept workers
 * and residents are observed. Keeping current inventory accessible is a gameplay rule consistent with the
 * readable original's separate current/future stock; its exact routing is not independently observed.
 * Approximations: the builder-driven pace, and own goods counting toward the upgrade, since freezing them
 * can deadlock the economy.
 */
export const Upgrading = defineComponent<{
  /** The building's ordinary, still-accessible inventory. {@link Stockpile} serves as the separate build
   *  hold until completion, when both stores are merged again. */
  savedStock: Map<number, number>;
  /** Bill goods the building already held, seeded into the build hold instead; a cancel returns these
   *  amounts to the inventory. */
  seeded: Map<number, number>;
}>('Upgrading', 'economy');

/**
 * A {@link Building} a blow or a script has taken hitpoints off, carried until its Health is whole again.
 * `lastHitTick` is the tick the latest damage landed, so the builder drive can wait out an attack before
 * sending a repair crew; null when the pool came up short without a blow, as after a script level change.
 */
export const Damaged = defineComponent<{ lastHitTick: number | null }>('Damaged', 'economy');
