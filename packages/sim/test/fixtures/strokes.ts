import { CurrentAtomic } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { atomicSystem } from '../../src/systems/index.js';
import { ctxOf } from './context.js';

/** Ticks the executor may spend on one stroke's follow-through and rest before the helper gives up. */
const CADENCE_GUARD_TICKS = 1000;

/**
 * Run the executor until the settler's stroke cadence releases it: after a counted stroke that left its
 * node standing, the follow-through clip and then the rest clip (`atomics/stroke-cadence.ts`). A stroke
 * that extracted, or a settler holding no atomic, returns at once.
 */
export function settleStrokeCadence(sim: Simulation, settler: Entity): void {
  for (let tick = 0; tick < CADENCE_GUARD_TICKS && sim.world.has(settler, CurrentAtomic); tick++) {
    atomicSystem(sim.world, ctxOf(sim));
  }
}
