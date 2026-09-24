import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import type { Entity } from '../../src/ecs/world.js';
import { defineComponent, World } from '../../src/ecs/world.js';

const P = defineComponent<{ n: number }>('CanonicalQueryP', 'economy');
const Q = defineComponent<{ n: number }>('CanonicalQueryQ', 'economy');
const R = defineComponent<{ n: number }>('CanonicalQueryR', 'economy');
const Unused = defineComponent<{ n: number }>('CanonicalQueryUnused', 'economy');

function sortedQuery(w: World, ...required: Parameters<World['query']>): Entity[] {
  return [...w.query(...required)].sort((a, b) => a - b);
}

describe('World.canonicalQuery', () => {
  it('matches a sorted query through adds, re-adds, removes and destroys', () => {
    const w = new World();
    const rng = new Rng(7);
    const entities: Entity[] = [];
    const components = [P, Q, R];
    for (let step = 0; step < 400; step++) {
      const roll = rng.int(10);
      if (roll === 0 || entities.length === 0) {
        entities.push(w.create());
      } else {
        const e = entities[rng.int(entities.length)];
        const c = components[rng.int(components.length)];
        if (e === undefined || c === undefined || !w.isAlive(e)) continue;
        if (roll === 1) w.destroy(e);
        else if (roll < 5) w.remove(e, c);
        else w.add(e, c, { n: step }); // a re-add replaces the value without changing membership
      }
      // Query both shapes every few steps so the lists are updated incrementally, not rebuilt once.
      if (step % 3 === 0) {
        expect(w.canonicalQuery(P)).toEqual(sortedQuery(w, P));
        expect(w.canonicalQuery(Q, P)).toEqual(sortedQuery(w, Q, P));
        expect(w.canonicalQuery(P, Q, R)).toEqual(sortedQuery(w, P, Q, R));
        expect(w.verifyCaches()).toEqual([]);
      }
    }
  });

  it('keeps ascending order when an older entity re-enters a store', () => {
    const w = new World();
    const [a, b, c] = [w.create(), w.create(), w.create()];
    for (const e of [a, b, c]) w.add(e, P, { n: 0 });
    expect(w.canonicalQuery(P)).toEqual([a, b, c]);
    w.remove(a, P);
    w.add(a, P, { n: 1 }); // the store now iterates b, c, a
    expect([...w.query(P)]).toEqual([b, c, a]);
    expect(w.canonicalQuery(P)).toEqual([a, b, c]);
  });

  it('serves one frozen list until membership changes', () => {
    const w = new World();
    const e = w.create();
    w.add(e, P, { n: 0 });
    w.add(e, Q, { n: 0 });
    const single = w.canonicalQuery(P);
    const joint = w.canonicalQuery(P, Q);
    expect(() => (single as Entity[]).push(e)).toThrow();
    expect(() => (joint as Entity[]).pop()).toThrow();
    w.add(e, P, { n: 1 });
    expect(w.canonicalQuery(P)).toBe(single);
    expect(w.canonicalQuery(P, Q)).toBe(joint);
    // A held list is a snapshot: a later membership change hands out a new list and leaves it alone.
    w.remove(e, Q);
    expect(w.canonicalQuery(P, Q)).toEqual([]);
    expect(joint).toEqual([e]);
  });

  it('answers empty for an unregistered component and tracks it once it exists', () => {
    const w = new World();
    expect(w.canonicalQuery()).toEqual([]);
    expect(w.canonicalQuery(Unused)).toEqual([]);
    const e = w.create();
    w.add(e, P, { n: 0 });
    expect(w.canonicalQuery(P, Unused)).toEqual([]);
    w.add(e, Unused, { n: 0 });
    expect(w.canonicalQuery(P, Unused)).toEqual([e]);
    expect(w.canonicalQuery(Unused)).toEqual([e]);
  });

  it('verifyCaches reports a tracked list that drifted from its store', () => {
    const w = new World();
    const e = w.create();
    w.add(e, P, { n: 0 });
    w.add(e, Q, { n: 0 });
    w.canonicalQuery(P, Q);
    expect(w.verifyCaches()).toEqual([]);
    // No public seam can produce this: the missed update the verifier exists for.
    const members = Reflect.get(Reflect.get(w, 'canonicalQueries'), 'members') as Map<
      unknown,
      { ids: Entity[] }
    >;
    members.get(P)?.ids.push(99 as Entity);
    expect(w.verifyCaches()).toEqual(['canonicalQuery(CanonicalQueryP) members diverge from the store']);
  });
});
