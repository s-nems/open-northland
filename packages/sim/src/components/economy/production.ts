import { defineComponent } from '../../ecs/world.js';

/** One in-flight production BATCH — see {@link Production}. */
export interface ProductionCycle {
  /** Whole ticks elapsed in this cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks this cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
}

/**
 * The in-progress production cycles on a workplace (a {@link Building} whose building type carries a
 * `recipe`) — a LIST, one independent batch per operator working the craft, so two millers grind two
 * flours in parallel (each cycle consumed its own inputs at start and deposits its own outputs at
 * completion; observed original behaviour — a multi-worker workshop out-produces a single-worker
 * one). Each tick the ProductionSystem advances as many cycles as there are operators ON STATION
 * (FIFO — the oldest batch first), so a departed worker's batch simply waits; new cycles start while
 * there are more present operators than running cycles and the inputs/room allow. The component
 * exists only while at least one cycle runs — its absence means the workplace is idle.
 *
 * Today every cycle runs the building type's ONE recipe; the per-cycle shape is deliberately a list
 * of independent batches so a future multi-recipe workshop (one smith forging long swords while the
 * other forges short) can hang the recipe choice on the cycle without reshaping the state.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration` mirrors the recipe's
 * `ticks` (snapshotted so a content edit mid-cycle can't change an in-flight cycle's length).
 */
export const Production = defineComponent<{
  /** The independent in-flight batches, oldest first (advanced FIFO; completed ones are removed). */
  cycles: ProductionCycle[];
}>('Production');
