import { Production, workClockTicks } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import type { SystemContext } from '../../src/systems/index.js';

/**
 * Adapt a `Simulation` into the `SystemContext` a single system reads when driven directly (outside
 * the full `step()` schedule). Superset shape: it always forwards `sim.commands`, which systems that
 * do not read commands simply ignore, and includes `terrain` only when the sim was built with a map.
 */
export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    names: sim.names,
    tick: fixtureTick(sim),
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
    ...(sim.fog !== undefined ? { fog: sim.fog } : {}),
    ...(sim.missions !== undefined ? { missions: sim.missions } : {}),
  };
}

const manualTicks = new WeakMap<Simulation, number>();

/** Current tick of a fixture driven one system at a time, or the full simulation tick. */
export function fixtureTick(sim: Simulation): number {
  return Math.max(sim.tick, manualTicks.get(sim) ?? 0);
}

/** Advance a direct-system fixture's time once; reuse the result for systems sharing that tick. */
export function nextTickCtxOf(sim: Simulation): SystemContext {
  manualTicks.set(sim, fixtureTick(sim) + 1);
  return ctxOf(sim);
}

/** The ticks worked on `building`'s production batch `index` as the fixture's tick reads its clock;
 *  undefined without that batch. */
export function batchTicks(sim: Simulation, building: Entity, index = 0): number | undefined {
  const cycle = sim.world.tryGet(building, Production)?.cycles[index];
  return cycle === undefined ? undefined : workClockTicks(cycle, fixtureTick(sim));
}
