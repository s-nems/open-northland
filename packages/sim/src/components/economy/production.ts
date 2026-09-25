import { defineComponent } from '../../ecs/world.js';

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

/**
 * A craft worker's product order - which of its workplace's products it crafts, set by the `setCraftGoods`
 * command. An empty `goods` - or an absent component - means every product the workplace offers. With
 * several selected, each started cycle takes the one at `cursor`, skipping a full output slot but waiting
 * for missing inputs before advancing past it. Authored: the 1:1 alternation over a multi-pick is a design choice,
 * since the original's per-worker product scheduling is unknown.
 */
export const CraftSelection = defineComponent<{
  /** Selected product goodTypes, ascending (deduped); empty = all the workplace's products. */
  goods: number[];
  /** Rotation position into the effective product list (`>= 0`; consumers take it modulo the list). */
  cursor: number;
}>('CraftSelection', 'economy');

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
