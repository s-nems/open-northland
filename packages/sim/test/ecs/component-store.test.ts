import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/component.js';
import { ABSENT_SLOT, ComponentStore } from '../../src/ecs/component-store.js';
import { PAGE_SIZE } from '../../src/ecs/paged-blocks.js';
import { QueryIterator } from '../../src/ecs/query-iterator.js';
import { defineComponent, World } from '../../src/ecs/world.js';

const Walked = defineComponent<number>('ComponentStoreWalked', 'economy');
const Probed = defineComponent<number>('ComponentStoreProbed', 'economy');

/** A small LCG so the op sequences repeat without the sim's Rng. */
function lcg(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

const ENTITY_RANGE = 2000;
const OPS = 20_000;

describe('ComponentStore', () => {
  it('matches a Map in membership, values and insertion order through churn and compaction', () => {
    const next = lcg(7);
    const store = new ComponentStore<number>();
    const reference = new Map<Entity, number>();
    for (let op = 0; op < OPS; op++) {
      const e = (1 + next(ENTITY_RANGE)) as Entity;
      if (next(3) === 0) {
        expect(store.delete(e)).toBe(reference.delete(e));
      } else {
        expect(store.set(e, op)).toBe(!reference.has(e));
        reference.set(e, op);
      }
    }
    expect(store.size).toBe(reference.size);
    expect(store.keys()).toEqual([...reference.keys()]);
    expect([...store.entries()]).toEqual([...reference.entries()]);
    for (let e = 1; e <= ENTITY_RANGE; e++) {
      expect(store.get(e as Entity)).toBe(reference.get(e as Entity));
      expect(store.has(e as Entity)).toBe(reference.has(e as Entity));
    }
  });

  it('a query walk sees removals, re-adds and compactions mid-walk exactly like a Map iterator', () => {
    const next = lcg(11);
    const world = new World();
    const reference = new Map<Entity, number>();
    const ids: Entity[] = [];
    for (let i = 0; i < ENTITY_RANGE; i++) {
      const e = world.create();
      ids.push(e);
      world.add(e, Walked, i);
      reference.set(e, i);
    }
    const mutate = (): void => {
      // Mostly removals, so vacated slots pile up and the store compacts under the open walk.
      for (let k = 0; k < 3; k++) {
        const e = ids[next(ids.length)];
        if (e === undefined) continue;
        if (next(4) === 0) {
          world.add(e, Walked, k);
          reference.set(e, k);
        } else {
          world.remove(e, Walked);
          reference.delete(e);
        }
      }
    };
    const walked: Entity[] = [];
    for (const e of world.query(Walked)) {
      walked.push(e);
      mutate();
    }
    const replay = lcg(11);
    const replayWorld = new Map<Entity, number>();
    for (let i = 0; i < ENTITY_RANGE; i++) replayWorld.set(ids[i] as Entity, i);
    const expected: Entity[] = [];
    for (const e of replayWorld.keys()) {
      expected.push(e);
      for (let k = 0; k < 3; k++) {
        const target = ids[replay(ids.length)];
        if (target === undefined) continue;
        if (replay(4) === 0) replayWorld.set(target, k);
        else replayWorld.delete(target);
      }
    }
    expect(walked).toEqual(expected);
    expect([...world.query(Walked)]).toEqual([...reference.keys()]);
  });
});

/** Enough members that removing half of them passes the store's vacancy count and share, so it compacts. */
const COMPACTING_SIZE = 200;
const HIGHEST_ENTITY = 0x7fffffff;

function filledStore(count: number): ComponentStore<number> {
  const store = new ComponentStore<number>();
  for (let e = 1; e <= count; e++) store.set(e as Entity, e * 10);
  return store;
}

function queryOver(store: ComponentStore<number>): QueryIterator {
  const stores: Array<ComponentStore<unknown>> = [];
  stores[Walked.id] = store;
  return new QueryIterator(stores, [Walked]);
}

describe('ComponentStore compaction', () => {
  it('compacts once vacancies pass the threshold, bumps the epoch and remaps slots', () => {
    const store = filledStore(COMPACTING_SIZE);
    for (let e = 1; e <= COMPACTING_SIZE / 2; e++) store.delete(e as Entity);
    expect(store.epoch).toBeGreaterThan(0);
    expect(store.length).toBeLessThan(COMPACTING_SIZE);
    for (let e = COMPACTING_SIZE / 2 + 1; e <= COMPACTING_SIZE; e++) {
      const slot = store.slotOf(e as Entity);
      expect(slot).not.toBe(ABSENT_SLOT);
      expect(store.entities[slot]).toBe(e);
      expect(store.valueAt(slot)).toBe(e * 10);
    }
    expect(store.slotOf(1 as Entity)).toBe(ABSENT_SLOT);
  });

  it('shrinks its dense arrays after a compaction leaves them mostly empty', () => {
    const store = filledStore(COMPACTING_SIZE * 5);
    const grown = store.entities.length;
    const kept = new Map<Entity, number>();
    for (let e = 1; e <= COMPACTING_SIZE * 5; e++) {
      if (e % 50 === 0) kept.set(e as Entity, e * 10);
      else store.delete(e as Entity);
    }
    expect(store.entities.length).toBeLessThan(grown);
    expect([...store.entries()]).toEqual([...kept.entries()]);
  });

  it('a query created before a compaction starts from the first survivor', () => {
    const store = filledStore(COMPACTING_SIZE);
    const query = queryOver(store);
    const epoch = store.epoch;
    for (let e = 1; e <= COMPACTING_SIZE / 2; e++) store.delete(e as Entity);
    expect(store.epoch).not.toBe(epoch);
    expect([...query]).toEqual(store.keys());
  });

  it('nested queries over one store survive a compaction like nested Map iterators', () => {
    const walk = (keys: () => Iterable<Entity>, remove: (e: Entity) => void): number[] => {
      const log: number[] = [];
      let outerVisits = 0;
      for (const outer of keys()) {
        log.push(outer);
        if (outerVisits++ !== 1) continue;
        for (const inner of keys()) {
          log.push(-inner);
          if (inner % 3 !== 0) remove(inner);
        }
      }
      return log;
    };
    const store = filledStore(COMPACTING_SIZE);
    const reference = new Map<Entity, number>();
    for (let e = 1; e <= COMPACTING_SIZE; e++) reference.set(e as Entity, e * 10);
    const walked = walk(
      () => queryOver(store),
      (e) => store.delete(e),
    );
    expect(store.epoch).toBeGreaterThan(0);
    expect(walked).toEqual(
      walk(
        () => reference.keys(),
        (e) => reference.delete(e),
      ),
    );
  });

  it('an exhausted query stays done after an add, like a Map iterator', () => {
    const store = filledStore(2);
    const query = queryOver(store);
    expect([...query]).toEqual([1, 2]);
    store.set(3 as Entity, 30);
    expect(query.next().done).toBe(true);
  });

  it('entries() throws when the store compacts under it', () => {
    const store = filledStore(COMPACTING_SIZE);
    expect(() => {
      for (const [e] of store.entries()) store.delete(e);
    }).toThrow(/compacted/);
  });

  it('accepts ids up to the highest Int32 and rejects the rest', () => {
    const store = new ComponentStore<string>();
    store.set(1 as Entity, 'low');
    store.set((HIGHEST_ENTITY - 1) as Entity, 'high');
    store.set(HIGHEST_ENTITY as Entity, 'top');
    expect(store.get((HIGHEST_ENTITY - 1) as Entity)).toBe('high');
    expect(store.keys()).toEqual([1, HIGHEST_ENTITY - 1, HIGHEST_ENTITY]);
    expect(store.delete((HIGHEST_ENTITY - 1) as Entity)).toBe(true);
    expect(store.has((HIGHEST_ENTITY - 1) as Entity)).toBe(false);
    for (const bad of [0, -1, HIGHEST_ENTITY + 1]) {
      expect(() => store.set(bad as Entity, 'bad')).toThrow(RangeError);
    }
    expect(store.size).toBe(2);
  });

  it('a lone member toggled every tick reuses its emptied index block', () => {
    const toggles = 10_000;
    const store = new ComponentStore<number>();
    for (let tick = 0; tick < toggles; tick++) {
      store.set(1 as Entity, tick);
      store.delete(1 as Entity);
    }
    const emptyBlockAndOne = 2 * PAGE_SIZE;
    expect((Reflect.get(store, 'index') as Int32Array).length).toBe(emptyBlockAndOne);
  });

  it('hands an emptied block to the next new page with every entry vacant', () => {
    const store = new ComponentStore<number>();
    const first = 1 as Entity;
    const far = (first + PAGE_SIZE * 3) as Entity;
    store.set(first, 1);
    store.delete(first);
    store.set(far, 2);
    expect(store.get(far)).toBe(2);
    for (let offset = 1; offset < PAGE_SIZE; offset++) {
      expect(store.has(((far & ~(PAGE_SIZE - 1)) + offset) as Entity)).toBe(
        offset === (far & (PAGE_SIZE - 1)),
      );
    }
    expect(store.has(first)).toBe(false);
  });

  it('stores and walks far-apart ids beside a low one', () => {
    const store = new ComponentStore<number>();
    const ids = [1, 10_000_000, 0x7fff0000] as Entity[];
    for (const [i, e] of ids.entries()) store.set(e, i);
    expect(store.keys()).toEqual(ids);
    for (const [i, e] of ids.entries()) expect(store.get(e)).toBe(i);
    expect(store.delete(ids[1] as Entity)).toBe(true);
    expect(store.has(ids[1] as Entity)).toBe(false);
    expect(store.get(ids[2] as Entity)).toBe(2);
  });
});

describe('World over compacting stores', () => {
  it('walks the smallest store by live size, not by dense length', () => {
    const world = new World();
    const ids: Entity[] = [];
    for (let i = 0; i < 100; i++) ids.push(world.create());
    for (const e of ids) world.add(e, Walked, 0);
    // Below the compaction count, so Walked keeps 100 dense slots for its 40 live members.
    for (const e of ids.slice(40)) world.remove(e, Walked);
    for (const e of ids.slice(0, 50).reverse()) world.add(e, Probed, 0);
    expect([...world.query(Walked, Probed)]).toEqual(ids.slice(0, 40));
    expect([...world.query(Probed, Walked)]).toEqual(ids.slice(0, 40));
  });

  it('keeps revisions and component visits through a compaction and drops them with a remove', () => {
    const world = new World();
    const ids: Entity[] = [];
    for (let i = 0; i < COMPACTING_SIZE; i++) {
      const e = world.create();
      ids.push(e);
      world.add(e, Walked, i);
    }
    const survivor = ids[COMPACTING_SIZE - 1] as Entity;
    world.mut(survivor, Walked);
    const revision = world.revisionOf(survivor, Walked);
    for (const e of ids.slice(0, COMPACTING_SIZE / 2)) world.remove(e, Walked);
    expect(world.revisionOf(survivor, Walked)).toBe(revision);
    const visits: Array<[string, unknown, number]> = [];
    world.forEachComponent(survivor, (name, value, rev) => visits.push([name, value, rev]));
    expect(visits).toEqual([[Walked.name, COMPACTING_SIZE - 1, revision]]);

    world.remove(survivor, Walked);
    expect(world.revisionOf(survivor, Walked)).toBeUndefined();
    world.forEachComponent(survivor, () => expect.unreachable());
    world.add(survivor, Walked, -1);
    expect(world.revisionOf(survivor, Walked)).not.toBe(revision);
    expect(world.componentEntries(survivor)).toEqual([[Walked.name, -1]]);
  });

  it('round-trips its stores through the save seams after churn', () => {
    const next = lcg(23);
    const world = new World();
    const ids: Entity[] = [];
    for (let i = 0; i < ENTITY_RANGE; i++) ids.push(world.create());
    for (let op = 0; op < OPS; op++) {
      const e = ids[next(ids.length)] as Entity;
      if (next(3) === 0) world.remove(e, Walked);
      else world.add(e, Walked, op);
    }
    const restored = new World();
    restored.restoreAllocation(world.nextEntityId, world.canonicalEntities());
    world.forEachStore((name, entries) => {
      expect(name).toBe(Walked.name);
      restored.restoreStore(Walked, [...entries]);
    });
    expect([...restored.query(Walked)]).toEqual([...world.query(Walked)]);
    for (const e of world.query(Walked)) expect(restored.get(e, Walked)).toBe(world.get(e, Walked));
  });
});
