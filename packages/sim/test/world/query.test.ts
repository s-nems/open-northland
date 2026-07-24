import { describe, expect, it } from 'vitest';
import { defineComponent, type Entity, World } from '../../src/ecs/world.js';

/**
 * World.query is a hand-written iterator that REUSES one result object across `next()` steps (the per-step
 * `{value,done}` a generator churned was the sim's largest steady allocation). These tests pin the contract
 * that reuse must not break: the same entities, in the same smallest-store insertion order, materialized
 * correctly by spread/for-of, safe under nesting (each call is its own iterator) and early break.
 */

const A = defineComponent<number>('A');
const B = defineComponent<number>('B');
const C = defineComponent<number>('C');

describe('World.query', () => {
  it('yields the intersection in smallest-store insertion order', () => {
    const w = new World();
    const ids: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const e = w.create();
      ids.push(e);
      w.add(e, A, i);
      if (i % 2 === 0) w.add(e, B, i); // 0,2,4 carry B
    }
    // Driven by the smaller store (B: 3 entries), the result is B's insertion order filtered to A-holders.
    expect([...w.query(A, B)]).toEqual([ids[0], ids[2], ids[4]]);
    // Single-store query needs no membership check and returns the whole store.
    expect([...w.query(A)]).toEqual(ids);
  });

  it('spread materializes DISTINCT ids — a reused result object must not leak a stale value', () => {
    const w = new World();
    const expected: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const e = w.create();
      w.add(e, A, i);
      expected.push(e);
    }
    // If the shared result object leaked (e.g. every entry ended up the last id), this array would be
    // [last, last, last, last] instead of the four distinct ids.
    const collected = [...w.query(A)];
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(collected.length);
  });

  it('supports a nested (reentrant) query — each call is an independent iterator', () => {
    const w = new World();
    const as: Entity[] = [];
    const bs: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const e = w.create();
      w.add(e, A, i);
      as.push(e);
    }
    for (let i = 0; i < 2; i++) {
      const e = w.create();
      w.add(e, B, i);
      bs.push(e);
    }
    const pairs: Array<[Entity, Entity]> = [];
    for (const a of w.query(A)) {
      for (const b of w.query(B)) pairs.push([a, b]);
    }
    expect(pairs).toEqual([
      [as[0], bs[0]],
      [as[0], bs[1]],
      [as[1], bs[0]],
      [as[1], bs[1]],
      [as[2], bs[0]],
      [as[2], bs[1]],
    ]);
  });

  it('is correct after an early break, and re-querying restarts cleanly', () => {
    const w = new World();
    const ids: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const e = w.create();
      w.add(e, A, i);
      ids.push(e);
    }
    let first: Entity | undefined;
    for (const e of w.query(A)) {
      first = e;
      break; // abandon the iterator mid-stream
    }
    expect(first).toBe(ids[0]);
    expect([...w.query(A)]).toEqual(ids); // a fresh query still sees everything
  });

  it('is empty for a no-arg query and for any never-added required component', () => {
    const w = new World();
    const e = w.create();
    w.add(e, A, 1);
    expect([...w.query()]).toEqual([]);
    expect([...w.query(C)]).toEqual([]); // C store never created
    expect([...w.query(A, C)]).toEqual([]); // one missing component ⇒ no matches
  });
});
