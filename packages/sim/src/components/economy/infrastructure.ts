import type { Fixed } from '../../core/fixed.js';
import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the building type.
 * Never iterate this Map for a game decision - raw Map iteration is insertion-order and so
 * history-dependent; use {@link stockpileEntries}.
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

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
export const UnderConstruction = defineComponent<{ labor: Fixed }>('UnderConstruction');

/**
 * Marks a {@link Building} being upgraded into its type's `upgradeTarget` level. It rides beside
 * {@link UnderConstruction} - the upgrade re-opens the building as a construction site, dropping `built`
 * to 0 - and its presence switches the site's bill to the target tier's own `construction`, the level
 * difference rather than the cumulative from-scratch bill.
 *
 * The become-a-site-again flow, the separate build store, the difference-only cost, and the kept workers and
 * residents are observed. Approximations: the builder-driven pace, and own goods counting toward the
 * upgrade, since freezing them can deadlock the economy.
 */
export const Upgrading = defineComponent<{
  /** The pre-upgrade inventory, stashed so the emptied {@link Stockpile} can serve as the site's build
   *  hold, and merged back when the upgrade completes. */
  savedStock: Map<number, number>;
  /** Bill goods the building already held, seeded into the build hold instead; a cancel returns these
   *  amounts to the inventory. */
  seeded: Map<number, number>;
}>('Upgrading');

/**
 * A placed vehicle hull - a ship put on the map as a movable stockpile rather than a static building. It
 * owns a {@link Stockpile} the way a headquarters does, and carries the same `(type, tribe)` shape a
 * {@link Building} does, so a hull hashes and is queried exactly like one. Only an unlocked ship type is
 * ever stamped, so a `Vehicle` always references a ship its tribe may field.
 */
export const Vehicle = defineComponent<{ vehicleType: number; tribe: number }>('Vehicle');
