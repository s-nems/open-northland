import { type DeepReadonly, defineComponent, type Entity, type World } from '../../ecs/world.js';

/** One in-flight production batch of a {@link Production} workplace. */
export interface ProductionCycle {
  /** Whole ticks elapsed in this cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks this cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
  /** The product this batch crafts - the key of the building type's per-product recipe (its first output's
   *  goodType), snapshotted at cycle start like `duration`. */
  goodType: number;
}

/**
 * The in-progress production cycles on a workplace - one independent batch per operator working the craft,
 * so two millers grind two flours in parallel. As many cycles advance per tick as there are operators on
 * station, so a departed worker's batch simply waits. The component exists only while at least one cycle
 * runs.
 */
export const Production = defineComponent<{
  /** The independent in-flight batches, oldest first (advanced FIFO; completed ones are removed). */
  cycles: ProductionCycle[];
}>('Production', 'economy');

/** The largest finite production counter: units still to make of one product. */
export const PRODUCTION_COUNT_MAX = 10;
/** The counter value meaning "keep making this product": it never decrements. */
export const PRODUCTION_UNLIMITED = 11;
/** One product's counter: `0` stopped, `1..PRODUCTION_COUNT_MAX` units still to make, or
 *  {@link PRODUCTION_UNLIMITED}. */
export type ProductionCount = number;

/**
 * A craft worker's production counters - how many more units of each of its workplace's products it makes,
 * set by the `setProductionCount` and `setCraftGoods` commands. Original behavior: one counter per human
 * and product, `0` stopped, `1..10` units still to make, `11` unlimited.
 *
 * The rotation pool is every product whose counter is at least one, in the workplace's recipe order; each
 * started cycle takes the one at `cursor`, skipping a full output slot but waiting for missing inputs
 * before advancing past it. A finite counter decrements when the operator starts a cycle of that product,
 * and at `0` the product leaves the pool. Approximation: the original decrements on the finished unit;
 * cycles here are not attributed to an operator after they start.
 *
 * Authored: an absent component, or a product without an entry, reads as {@link PRODUCTION_UNLIMITED},
 * so a fresh hire rotates through every product. The original starts a fresh hire on its first product
 * unlimited and every other product at `0`. Authored: the 1:1 alternation over several live products is
 * a design choice, since the original's per-worker product scheduling is unknown.
 */
export const CraftSelection = defineComponent<{
  /** `[goodType, count]` for each product below {@link PRODUCTION_UNLIMITED}, ascending goodType, only
   *  goods the workplace makes; a product without an entry is unlimited. */
  counters: [goodType: number, count: ProductionCount][];
  /** Rotation position into the effective product list (`>= 0`; consumers take it modulo the list). */
  cursor: number;
}>('CraftSelection', 'economy');

/** A read-only {@link CraftSelection} value, as `World.get` and a snapshot hand it out. */
export type CraftSelectionView = DeepReadonly<NonNullable<(typeof CraftSelection)['__value']>>;

/** The counter `selection` holds for `goodType`; no selection or no entry reads as unlimited. */
export function productionCountOf(
  selection: CraftSelectionView | undefined,
  goodType: number,
): ProductionCount {
  if (selection === undefined) return PRODUCTION_UNLIMITED;
  // The read-only view widens each pair to an array, so the count reads as possibly absent.
  for (const [good, count] of selection.counters) if (good === goodType) return count ?? PRODUCTION_UNLIMITED;
  return PRODUCTION_UNLIMITED;
}

/**
 * A workplace's banked bonus output - the tenths past a whole unit of "an experienced baker bakes 2.5
 * bread per cycle". A remainder moves into the {@link Stockpile} as a whole unit the moment it reaches ten
 * tenths, so only whole units are ever visible to withdrawal (original behavior: the house keeps the
 * tenths). The component exists only while some remainder is non-zero.
 */
export const ProductionBonus = defineComponent<{
  /** goodType → the banked bonus output in tenths of a unit; past nine only while the shelf is full. */
  remainders: Map<number, number>;
}>('ProductionBonus', 'economy');

/**
 * Finished production cycles per product on a workplace that carries this component; the production system
 * counts only where a reader opted the building in, so an uncounted workplace holds no extra state.
 */
export const CompletedCycles = defineComponent<{
  /** Product goodType -> cycles finished since the component was added. */
  byGood: Map<number, number>;
}>('CompletedCycles', 'economy');

/**
 * Set `entity`'s counter for `goodType`, keeping {@link CraftSelection.counters} canonical: ascending, with
 * no entry for an unlimited product. Stamps the component when it is missing; an unchanged value writes
 * nothing.
 */
export function writeProductionCount(
  world: World,
  entity: Entity,
  goodType: number,
  count: ProductionCount,
): void {
  const selection = world.tryGet(entity, CraftSelection);
  if (productionCountOf(selection, goodType) === count) return;
  if (selection === undefined) {
    world.add(entity, CraftSelection, { counters: [[goodType, count]], cursor: 0 });
    return;
  }
  const counters = world.mut(entity, CraftSelection).counters;
  const at = counters.findIndex(([good]) => good >= goodType);
  const entry = at < 0 ? undefined : counters[at];
  if (entry !== undefined && entry[0] === goodType) {
    if (count === PRODUCTION_UNLIMITED) counters.splice(at, 1);
    else entry[1] = count;
    return;
  }
  counters.splice(at < 0 ? counters.length : at, 0, [goodType, count]);
}
