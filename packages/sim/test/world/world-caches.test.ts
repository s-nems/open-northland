import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import { defineComponent, World } from '../../src/ecs/world.js';

/**
 * The World cache-coherence guard: incremental caches are the classic lockstep-desync source, so
 * every memoized value must re-derive from authoritative state to the same bytes. Two halves:
 *
 *  - the shared `canonicalEntities()` memo is FROZEN, so a consumer that mutates it in place
 *    (.sort()/.reverse() - the documented never-do) throws at the mutation site;
 *  - `verifyCaches()` re-derives the memo from the alive set and reports a mismatch, so a missed
 *    invalidation is caught at the tick it happens (it runs inside CORE_INVARIANTS as
 *    `cachesCoherent`), not later as an unexplained golden/hash divergence.
 */
describe('World cache coherence', () => {
  it('canonicalEntities returns a frozen array - in-place mutation throws at the offender', () => {
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

  it('forEachComponent walks registration order regardless of per-entity add order', () => {
    const w = new World();
    const A = defineComponent<{ n: number }>('A');
    const B = defineComponent<{ n: number }>('B');
    const first = w.create();
    w.add(first, A, { n: 1 }); // registers A before B
    w.add(first, B, { n: 2 });
    const second = w.create();
    w.add(second, B, { n: 3 }); // reversed add order on this entity
    w.add(second, A, { n: 4 });
    // Registration order is the canonical component order `hashState` and snapshots depend on, so an
    // entity's own add order must not leak into the walk.
    const names: string[] = [];
    w.forEachComponent(second, (name) => names.push(name));
    expect(names).toEqual(['A', 'B']);
    expect(w.verifyCaches()).toEqual([]);
    w.remove(second, B);
    w.destroy(first);
    expect(w.verifyCaches()).toEqual([]);
    expect(w.componentEntries(second).map(([name]) => name)).toEqual(['A']);
  });

  it('verifyCaches reports a membership list that disagrees with the stores', () => {
    const w = new World();
    const A = defineComponent<{ n: number }>('A');
    const e = w.create();
    w.add(e, A, { n: 1 });
    expect(w.verifyCaches()).toEqual([]);
    // Both report branches, from a state no public seam can produce: a store entry no list names, then
    // a listed index the entity does not carry.
    const memberships = Reflect.get(w, 'memberships') as Map<Entity, number[]>;
    memberships.delete(e);
    expect(w.verifyCaches()).toEqual(['entity 1 carries A but its membership list misses it']);

    // The list-side branch: an index the entity does not carry.
    memberships.set(e, [0, 7]);
    expect(w.verifyCaches()).toEqual(['entity 1 lists component index 7 it does not carry']);

    memberships.set(e, [0, 0]);
    expect(w.verifyCaches()).toEqual(['entity 1 membership list is not ascending at index 0']);
  });

  it('verifyCaches reports the canonical memo, then memberships, then registered verifiers', () => {
    const w = new World();
    const A = defineComponent<{ n: number }>('A');
    const e = w.create();
    w.add(e, A, { n: 1 });
    w.canonicalEntities();
    w.registerCacheVerifier('registered', () => ['registered says stale']);
    Reflect.set(w, 'canonicalCache', Object.freeze([999 as Entity]));
    (Reflect.get(w, 'memberships') as Map<Entity, number[]>).delete(e);
    // A registered verifier can never preempt the World's own two checks.
    expect(w.verifyCaches()).toEqual([
      'canonicalEntities cache diverges at index 0: cached 999, alive 1 - stale memo',
      'entity 1 carries A but its membership list misses it',
      'registered says stale',
    ]);
  });

  it('verifyCaches reports a stale memo (a simulated missed invalidation)', () => {
    const w = new World();
    w.create();
    w.create();
    w.canonicalEntities(); // materialize the memo
    // Inject the failure mode the check exists for: the alive set changes but the memo is not
    // invalidated. No public seam can produce this (that is the point - it is a would-be bug), so
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
