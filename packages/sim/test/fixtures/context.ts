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
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}
