import { defineComponent } from '../../ecs/world.js';

/** One in-flight production BATCH — see {@link Production}. */
export interface ProductionCycle {
  /** Whole ticks elapsed in this cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks this cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
  /** The product this batch crafts — the key of the building type's per-product recipe (its
   *  first output's goodType), snapshotted at cycle start like `duration`. */
  goodType: number;
}

/**
 * The in-progress production cycles on a workplace (a {@link Building} whose building type carries
 * `recipes`) — a LIST, one independent batch per operator working the craft, so two millers grind two
 * flours in parallel (each cycle consumed its own recipe's inputs at start and deposits its own
 * output at completion; observed original behaviour — a multi-worker workshop out-produces a
 * single-worker one). Each tick the ProductionSystem advances as many cycles as there are operators
 * ON STATION (FIFO — the oldest batch first), so a departed worker's batch simply waits; new cycles
 * start while there are more present operators than running cycles and some product's inputs/room
 * allow. Which product a new cycle crafts is the starting operator's choice ({@link CraftSelection}).
 * The component exists only while at least one cycle runs — its absence means the workplace is idle.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration`/`goodType` mirror the
 * recipe at start (snapshotted so a content edit mid-cycle can't change an in-flight cycle).
 */
export const Production = defineComponent<{
  /** The independent in-flight batches, oldest first (advanced FIFO; completed ones are removed). */
  cycles: ProductionCycle[];
}>('Production');

/**
 * A craft worker's product order — which of its workplace's products it crafts, set by the
 * `setCraftGoods` command (the crafting twin of the gatherer's `WorkFlag.goodType` filter). `goods`
 * empty means "every product the workplace offers" (the default; the component may simply be absent).
 * With several products in rotation the worker alternates: each started cycle takes the product at
 * `cursor` (skipping ones whose inputs/room don't allow a start) and advances past it — one short
 * sword, one plate armor, one short sword… `cursor` indexes the effective rotation list (the selected
 * goods, or all workplace products when `goods` is empty), and is reset by a new selection.
 */
export const CraftSelection = defineComponent<{
  /** Selected product goodTypes, ascending (deduped); empty = all the workplace's products. */
  goods: number[];
  /** Rotation position into the effective product list (`>= 0`; consumers take it modulo the list). */
  cursor: number;
}>('CraftSelection');
