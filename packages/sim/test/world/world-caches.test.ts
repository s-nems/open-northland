import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import { World } from '../../src/ecs/world.js';

/**
 * The World cache-coherence guard: incremental caches are the classic lockstep-desync source, so
 * every memoized value must re-derive from authoritative state to the same bytes. Two halves:
 *
 *  - the shared `canonicalEntities()` memo is FROZEN, so a consumer that mutates it in place
 *    (.sort()/.reverse() — the documented never-do) throws at the mutation site;
 *  - `verifyCaches()` re-derives the memo from the alive set and reports a mismatch, so a missed
 *    invalidation is caught at the tick it happens (it runs inside CORE_INVARIANTS as
 *    `cachesCoherent`), not later as an unexplained golden/hash divergence.
 */
describe('World cache coherence', () => {
  it('canonicalEntities returns a frozen array — in-place mutation throws at the offender', () => {
    const w = new World();
    w.create();
    w.create();
    const ids = w.canonicalEntities();
    // The runtime enforcement behind the `readonly Entity[]` type: reverse() must throw, not
    // silently corrupt the canonical order every other consumer shares.
    expect(() => (ids as Entity[]).reverse()).toThrow();
    expect([...w.canonicalEntities()]).toEqual(ids);
  });

  it('verifyCaches is clean across create/destroy churn (invalidation works)', () => {
    const w = new World();
    const a = w.create();
    w.create();
    expect(w.verifyCaches()).toEqual([]);
    w.canonicalEntities(); // materialize the memo
    w.destroy(a);
    w.canonicalEntities();
    const c = w.create();
    w.canonicalEntities();
    w.destroy(c);
    expect(w.verifyCaches()).toEqual([]);
  });

  it('verifyCaches reports a stale memo (a simulated missed invalidation)', () => {
    const w = new World();
    w.create();
    w.create();
    w.canonicalEntities(); // materialize the memo
    // Inject the failure mode the check exists for: the alive set changes but the memo is not
    // invalidated. No public seam can produce this (that is the point — it is a would-be bug), so
    // corrupt the private field directly to prove the checker detects it. Both report branches:
    // a wrong LENGTH (an id missing/extra) and a same-length wrong CONTENT (an id swapped).
    Reflect.set(w, 'canonicalCache', Object.freeze([999 as Entity]));
    const shortViolations = w.verifyCaches();
    expect(shortViolations).toHaveLength(1);
    expect(shortViolations[0]).toContain('canonicalEntities cache');

    Reflect.set(w, 'canonicalCache', Object.freeze([1 as Entity, 999 as Entity]));
    const swappedViolations = w.verifyCaches();
    expect(swappedViolations).toHaveLength(1);
    expect(swappedViolations[0]).toContain('diverges at index 1');
  });
});
