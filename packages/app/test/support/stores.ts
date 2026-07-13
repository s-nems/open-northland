import { type Component, components } from '@open-northland/sim';

/**
 * Reset the sim's module-level component stores — the known footgun any test that builds more than one
 * `Simulation` in a process must guard against (root AGENTS.md "Durable Gotchas"). The stores are
 * singletons shared by every `Simulation`, so a sim built in one test sees entities a prior test left
 * behind, and `world.query` iterates store insertion order, so that leakage makes a fresh sim's planner
 * non-deterministic. `beforeEach(clearStores)` scopes each run to its own test regardless of file/test
 * order — exactly as the sim's own golden-trace suite does.
 */
export function clearStores(): void {
  // The `components` namespace also re-exports helpers (e.g. `stockpileEntries`), so clear only the
  // exports that are actual components (have a `.store` Map), not every value.
  for (const v of Object.values(components)) {
    const store = (v as Partial<Component<unknown>>).store;
    if (store instanceof Map) store.clear();
  }
}
