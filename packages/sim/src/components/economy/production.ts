import type { Fixed } from '../../core/fixed.js';
import { defineComponent } from '../../ecs/world.js';

/** One in-flight production batch of a {@link Production} workplace. */
export interface ProductionCycle {
  /** Whole ticks elapsed in this cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks this cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
  /** The product this batch crafts - the key of the building type's per-product recipe (its
   *  first output's goodType), snapshotted at cycle start like `duration`. */
  goodType: number;
}

/**
 * The in-progress production cycles on a workplace - one independent batch per operator working the craft,
 * so two millers grind two flours in parallel (observation: a multi-worker workshop out-produces a
 * single-worker one). Each tick the ProductionSystem advances as many cycles as there are operators on
 * station, oldest first, so a departed worker's batch simply waits. The component exists only while at
 * least one cycle runs.
 *
 * Timing is the exact integer compare `elapsed >= duration`, never an accumulated fixed-point step, which
 * would truncate and hang.
 */
export const Production = defineComponent<{
  /** The independent in-flight batches, oldest first (advanced FIFO; completed ones are removed). */
  cycles: ProductionCycle[];
}>('Production');

/**
 * A craft worker's product order - which of its workplace's products it crafts, set by the `setCraftGoods`
 * command. An empty `goods` means every product the workplace offers, and the component may simply be
 * absent. With several products selected each started cycle takes the one at `cursor`, skipping any whose
 * inputs or room don't allow a start, and advances past it. Authored: the 1:1 alternation over a multi-pick
 * is a design choice, since the original's per-worker product scheduling is not decoded.
 */
export const CraftSelection = defineComponent<{
  /** Selected product goodTypes, ascending (deduped); empty = all the workplace's products. */
  goods: number[];
  /** Rotation position into the effective product list (`>= 0`; consumers take it modulo the list). */
  cursor: number;
}>('CraftSelection');

/**
 * A workplace's fractional experience-bonus output - the decimal part of "an experienced baker bakes 1.5
 * bread per cycle". Each completed batch adds its operator's bonus fraction here per output good, and a
 * whole unit moves into the {@link Stockpile} the moment a fraction crosses ONE, so only whole units are
 * ever visible to withdrawal (authored: a 0.9 remainder cannot leave the building). The component exists
 * only while some remainder is non-zero.
 */
export const ProductionBonus = defineComponent<{
  /** goodType → the accumulated fractional bonus output (`Fixed`), pending its next whole unit. */
  remainders: Map<number, Fixed>;
}>('ProductionBonus');
