import { describe, expect, it } from 'vitest';
import { pickedGroup } from '../src/hud/tool-panel/residents/rows.js';
import { createUnitSelection, selectionAfter } from '../src/view/unit-controls/selection.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

/** Classifies every id as a unit, for tests about the set rather than the units-only rule. */
const ALL_UNITS = (): boolean => true;
/** Ids 100 and up stand for buildings in the units-only rule's tests. */
const FIRST_BUILDING = 100;
const BARRACKS = FIRST_BUILDING;
const SCHOOL = FIRST_BUILDING + 1;
const isUnit = (id: number): boolean => id < FIRST_BUILDING;

const gatherer = (id: number, flag: number): Ent => ({ id, components: { WorkFlag: { flag } } });
const idle = (id: number): Ent => ({ id, components: { Settler: { jobType: 8 } } });

describe('unit selection set', () => {
  it('replaces the set, or extends it when adding', () => {
    const selection = createUnitSelection(ALL_UNITS);
    selection.apply([1, 2], false);
    expect([...selection.ids()]).toEqual([1, 2]);
    selection.apply([3], true);
    expect([...selection.ids()]).toEqual([1, 2, 3]);
    selection.apply([4], false);
    expect([...selection.ids()]).toEqual([4]);
  });

  it('hands out one set mutated in place, so a held reference stays live', () => {
    const selection = createUnitSelection(ALL_UNITS);
    const held = selection.ids();
    selection.apply([7], false);
    expect(selection.ids()).toBe(held);
    expect(held.has(7)).toBe(true);
  });

  it('reports a change and bumps the version only when the set really moved', () => {
    const selection = createUnitSelection(ALL_UNITS);
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
    const selection = createUnitSelection(ALL_UNITS);
    selection.apply([1, 2], false);

    expect(selection.apply([3], true)).toBe(true);
    expect(selection.version()).toBe(2);
    expect([...selection.ids()]).toEqual([1, 2, 3]);
  });
});

describe('unit selection work flags', () => {
  const world = snapshotOf([gatherer(1, 101), gatherer(2, 102), idle(3)]);

  it('resolves the flags of the selected gatherers only', () => {
    const selection = createUnitSelection(ALL_UNITS);
    selection.apply([1, 3], false);
    expect([...selection.workFlagIds(world)]).toEqual([101]);
    selection.apply([2], true);
    expect([...selection.workFlagIds(world)]).toEqual([101, 102]);
  });

  it('answers an empty selection from one shared set, allocating nothing per frame', () => {
    const selection = createUnitSelection(ALL_UNITS);
    expect(selection.workFlagIds(world).size).toBe(0);
    expect(selection.workFlagIds(snapshotOf([gatherer(1, 101)]))).toBe(selection.workFlagIds(world));
  });

  it('reads the snapshot once per tick, and again when the selection changes inside that tick', () => {
    const { snapshot, visits } = visitCountingSnapshot(snapshotOf([gatherer(1, 101), gatherer(2, 102)]));
    const selection = createUnitSelection(ALL_UNITS);

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

describe('units-only selection rule', () => {
  it('lets a building added to units take the selection alone', () => {
    expect(selectionAfter([1, 2], [BARRACKS], true, isUnit)).toEqual([BARRACKS]);
    expect(selectionAfter([BARRACKS], [SCHOOL], true, isUnit)).toEqual([SCHOOL]);
    expect(selectionAfter([1], [2, BARRACKS, SCHOOL], true, isUnit)).toEqual([SCHOOL]);
  });

  it('lets a unit added to a building replace it, and units then accumulate', () => {
    const replaced = selectionAfter([BARRACKS], [1], true, isUnit);
    expect(replaced).toEqual([1]);
    expect(selectionAfter(replaced, [2, 3], true, isUnit)).toEqual([1, 2, 3]);
  });

  it('drops a building from a union with units, and keeps one picked alone', () => {
    expect(selectionAfter([], [BARRACKS, 1, 2], false, isUnit)).toEqual([1, 2]);
    expect(selectionAfter([1], [BARRACKS], false, isUnit)).toEqual([BARRACKS]);
    expect(selectionAfter([1], [BARRACKS, SCHOOL], false, isUnit)).toEqual([SCHOOL]);
  });

  it('drops a held building from a residents Ctrl-click or range union', () => {
    const shown = [1, 2, 3];
    const held = new Set([BARRACKS]);
    expect(selectionAfter(held, pickedGroup('toggle', 2, held, shown, null), false, isUnit)).toEqual([2]);
    expect(selectionAfter(held, pickedGroup('add-range', 3, held, shown, 1), false, isUnit)).toEqual([
      1, 2, 3,
    ]);
  });

  it('applies the rule through the selection set', () => {
    const selection = createUnitSelection(isUnit);
    selection.apply([1, 2], false);
    selection.apply([BARRACKS], true);
    expect([...selection.ids()]).toEqual([BARRACKS]);
    selection.apply([3], true);
    expect([...selection.ids()]).toEqual([3]);
  });
});

describe('unit selection gone members', () => {
  const unit = (id: number): Ent => ({ id, components: { Settler: {} } });

  it('drops only the members the snapshot no longer holds, and clears when all went', () => {
    const selection = createUnitSelection(ALL_UNITS);
    selection.apply([1, 2, 3], false);
    const before = selection.version();

    expect(selection.dropGone(snapshotOf([unit(1), unit(3)], 1))).toBe(true);
    expect([...selection.ids()]).toEqual([1, 3]);
    expect(selection.version()).toBe(before + 1);

    expect(selection.dropGone(snapshotOf([], 2))).toBe(true);
    expect(selection.ids().size).toBe(0);
  });

  it('looks the members up once per snapshot and selection change', () => {
    const { snapshot, visits } = visitCountingSnapshot(snapshotOf([unit(1), unit(2)]));
    const selection = createUnitSelection(ALL_UNITS);
    selection.apply([1, 2], false);

    expect(selection.dropGone(snapshot)).toBe(false);
    const afterFirst = visits();
    expect(selection.dropGone(snapshot)).toBe(false); // a frame between ticks checks nothing
    expect(visits()).toBe(afterFirst);

    selection.apply([2], false);
    expect(selection.dropGone(snapshot)).toBe(false);
    expect(visits()).toBeGreaterThan(afterFirst);
  });
});
