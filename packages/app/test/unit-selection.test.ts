import { describe, expect, it } from 'vitest';
import { createUnitSelection } from '../src/view/unit-controls/selection.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

const gatherer = (id: number, flag: number): Ent => ({ id, components: { WorkFlag: { flag } } });
const idle = (id: number): Ent => ({ id, components: { Settler: { jobType: 8 } } });

describe('unit selection set', () => {
  it('replaces the set, or extends it when adding', () => {
    const selection = createUnitSelection();
    selection.apply([1, 2], false);
    expect([...selection.ids()]).toEqual([1, 2]);
    selection.apply([3], true);
    expect([...selection.ids()]).toEqual([1, 2, 3]);
    selection.apply([4], false);
    expect([...selection.ids()]).toEqual([4]);
  });

  it('hands out one set mutated in place, so a held reference stays live', () => {
    const selection = createUnitSelection();
    const held = selection.ids();
    selection.apply([7], false);
    expect(selection.ids()).toBe(held);
    expect(held.has(7)).toBe(true);
  });

  it('reports a change and bumps the version only when the set really moved', () => {
    const selection = createUnitSelection();
    expect(selection.version()).toBe(0);

    expect(selection.apply([1, 2], false)).toBe(true);
    expect(selection.version()).toBe(1);

    // Re-clicking the same unit and adding one already in the set both leave the set alone.
    expect(selection.apply([1, 2], false)).toBe(false);
    expect(selection.apply([2], true)).toBe(false);
    expect(selection.version()).toBe(1);

    expect(selection.apply([], false)).toBe(true); // cleared
    expect(selection.version()).toBe(2);

    // Clearing an empty set, and adding nothing, are both no-ops.
    expect(selection.apply([], false)).toBe(false);
    expect(selection.apply([], true)).toBe(false);
    expect(selection.version()).toBe(2);
  });

  it('extends a non-empty set with an id it does not hold yet', () => {
    const selection = createUnitSelection();
    selection.apply([1, 2], false);

    expect(selection.apply([3], true)).toBe(true);
    expect(selection.version()).toBe(2);
    expect([...selection.ids()]).toEqual([1, 2, 3]);
  });
});

describe('unit selection work flags', () => {
  const world = snapshotOf([gatherer(1, 101), gatherer(2, 102), idle(3)]);

  it('resolves the flags of the selected gatherers only', () => {
    const selection = createUnitSelection();
    selection.apply([1, 3], false);
    expect([...selection.workFlagIds(world)]).toEqual([101]);
    selection.apply([2], true);
    expect([...selection.workFlagIds(world)]).toEqual([101, 102]);
  });

  it('answers an empty selection from one shared set, allocating nothing per frame', () => {
    const selection = createUnitSelection();
    expect(selection.workFlagIds(world).size).toBe(0);
    expect(selection.workFlagIds(snapshotOf([gatherer(1, 101)]))).toBe(selection.workFlagIds(world));
  });

  it('reads the snapshot once per tick, and again when the selection changes inside that tick', () => {
    const { snapshot, visits } = visitCountingSnapshot(snapshotOf([gatherer(1, 101), gatherer(2, 102)]));
    const selection = createUnitSelection();

    selection.apply([1], false);
    expect([...selection.workFlagIds(snapshot)]).toEqual([101]);
    const afterFirst = visits();
    expect(afterFirst).toBeGreaterThan(0);

    expect([...selection.workFlagIds(snapshot)]).toEqual([101]); // same tick, same selection: memoized
    expect(visits()).toBe(afterFirst);

    // A click re-selects inside one tick, so snapshot identity alone must not hold the stale answer.
    selection.apply([2], false);
    expect([...selection.workFlagIds(snapshot)]).toEqual([102]);
    expect(visits()).toBeGreaterThan(afterFirst);
  });
});
