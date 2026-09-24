import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { FLEE_CHECK_STRIDE_TICKS } from '../../src/systems/conflict/flee.js';
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
    ...(sim.fog !== undefined ? { fog: sim.fog } : {}),
    ...(sim.missions !== undefined ? { missions: sim.missions } : {}),
  };
}

/** {@link ctxOf} moved on to the first tick, from the sim's own, on which calm FLEE unit `e` looks for a
 *  threat - a single direct combat pass then sees the check a full schedule would run within the stride. */
export function fleeCheckCtxOf(sim: Simulation, e: Entity): SystemContext {
  const ctx = ctxOf(sim);
  const wait =
    (FLEE_CHECK_STRIDE_TICKS - ((ctx.tick + e) % FLEE_CHECK_STRIDE_TICKS)) % FLEE_CHECK_STRIDE_TICKS;
  return { ...ctx, tick: ctx.tick + wait };
}
