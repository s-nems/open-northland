import { components } from '../../src/index.js';

/**
 * Clear EVERY component store — always the whole namespace, never a hand-picked subset (the
 * multi-sim store trap, sim AGENTS.md): stores are module-level singletons, so entries from one
 * test's discarded World survive into the next, where a fresh World re-mints the same entity ids
 * and a query-order decision silently diverges. A subset list rots the moment a system consumed by
 * the suite grows a new component.
 */
export function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) c.store.clear();
  }
}
