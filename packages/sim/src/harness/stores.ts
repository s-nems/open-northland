import * as components from '../components/index.js';
import type { Component } from '../ecs/world.js';

/**
 * Clear EVERY component store — the multi-sim harness reset. Component stores are module-level
 * singletons shared by every `Simulation`/`World` in a process (packages/sim/AGENTS.md, "the loop's
 * most-rediscovered trap"): any test or harness that builds more than one sim MUST call this between
 * builds, or the earlier run's entities leak onto the later run's reused ids and a query-order
 * decision diverges. Sweeps the WHOLE component namespace (never a hand-picked subset — that misses
 * the component a future system adds); the namespace also re-exports plain helpers, so only values
 * with a live `store` Map are cleared.
 */
export function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) {
      (c as Component<unknown>).store.clear();
    }
  }
}
