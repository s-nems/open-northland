import { tileToScreen } from '@open-northland/render';
import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import {
  controlGroupCommand,
  createControlGroups,
  groupCentre,
  groupRecallEffect,
  isControlGroupMember,
} from '../src/view/unit-controls/control-groups.js';
import { building, settler, snapshotOf } from './support/snapshot.js';

/** Classifies every id as a unit, for tests about membership rather than the units-only rule. */
const ALL_UNITS = (): boolean => true;

const press = (overrides: Partial<Parameters<typeof controlGroupCommand>[0]> = {}) => ({
  code: 'Digit1',
  repeat: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

describe('controlGroupCommand', () => {
  it('maps plain, Ctrl, and Shift presses through the current binding', () => {
    expect(controlGroupCommand(press(), DEFAULT_KEY_BINDINGS)).toEqual({
      action: 'controlGroup1',
      mode: 'recall',
    });
    expect(controlGroupCommand(press({ ctrlKey: true }), DEFAULT_KEY_BINDINGS)?.mode).toBe('replace');
    expect(controlGroupCommand(press({ shiftKey: true }), DEFAULT_KEY_BINDINGS)?.mode).toBe('add');
    expect(
      controlGroupCommand(press({ code: 'KeyG' }), {
        ...DEFAULT_KEY_BINDINGS,
        controlGroup1: 'KeyG',
      })?.action,
    ).toBe('controlGroup1');
  });

  it('uses independently rebound recall, replace, and steal chords', () => {
    const bindings = {
      ...DEFAULT_KEY_BINDINGS,
      controlGroup1: 'KeyR',
      controlGroup1Replace: 'Shift+KeyR',
      controlGroup1Add: 'Ctrl+KeyG',
    };
    expect(controlGroupCommand(press({ code: 'KeyR' }), bindings)?.mode).toBe('recall');
    expect(controlGroupCommand(press({ code: 'KeyR', shiftKey: true }), bindings)?.mode).toBe('replace');
    expect(controlGroupCommand(press({ code: 'KeyG', ctrlKey: true }), bindings)?.mode).toBe('add');
  });

  it('reads a changed binding on the next press without remounting controls', () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS } as Record<keyof typeof DEFAULT_KEY_BINDINGS, string | null>;
    expect(controlGroupCommand(press({ ctrlKey: true }), bindings)?.mode).toBe('replace');

    bindings.controlGroup1Replace = 'Alt+Digit1';

    expect(controlGroupCommand(press({ ctrlKey: true }), bindings)).toBeNull();
    expect(controlGroupCommand(press({ altKey: true }), bindings)?.mode).toBe('replace');
  });

  it('leaves repeats and chords without an exact binding unclaimed', () => {
    expect(controlGroupCommand(press({ repeat: true }), DEFAULT_KEY_BINDINGS)).toBeNull();
    expect(controlGroupCommand(press({ ctrlKey: true, shiftKey: true }), DEFAULT_KEY_BINDINGS)).toBeNull();
    expect(controlGroupCommand(press({ altKey: true }), DEFAULT_KEY_BINDINGS)).toBeNull();
    expect(controlGroupCommand(press({ metaKey: true }), DEFAULT_KEY_BINDINGS)).toBeNull();
  });

  it('does not claim an unbound group', () => {
    expect(controlGroupCommand(press(), { ...DEFAULT_KEY_BINDINGS, controlGroup1: null })).toBeNull();
  });
});

describe('control groups', () => {
  it('recalls owned actors and vehicles off-screen but rejects foreign, neutral, and livestock refs', () => {
    const snapshot = snapshotOf([
      { id: 1, components: { Settler: {}, Owner: { player: 0 } } },
      { id: 2, components: { Building: {}, Owner: { player: 0 } } },
      { id: 3, components: { Settler: {}, Owner: { player: 1 } } },
      { id: 4, components: { Settler: {} } },
      { id: 5, components: { Settler: {}, Livestock: {}, Owner: { player: 0 } } },
      { id: 6, components: { Vehicle: {}, Owner: { player: 0 } } },
    ]);

    expect(isControlGroupMember(snapshot, 1, 0)).toBe(true);
    expect(isControlGroupMember(snapshot, 2, 0)).toBe(true);
    expect(isControlGroupMember(snapshot, 3, 0)).toBe(false);
    expect(isControlGroupMember(snapshot, 3, null)).toBe(true);
    expect(isControlGroupMember(snapshot, 4, null)).toBe(false);
    expect(isControlGroupMember(snapshot, 5, null)).toBe(false);
    expect(isControlGroupMember(snapshot, 6, 0)).toBe(true);
    expect(isControlGroupMember(snapshot, 99, null)).toBe(false);
  });

  it('Shift-adds members in insertion order and steals them from every other group', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [4, 2]);
    groups.replace('controlGroup2', [7, 9]);
    groups.replace('controlGroup3', [2, 8]);
    groups.addExclusive('controlGroup2', [2, 7]);

    expect(groups.recall('controlGroup1', () => true, ALL_UNITS)).toEqual([4]);
    expect(groups.recall('controlGroup2', () => true, ALL_UNITS)).toEqual([7, 9, 2]);
    expect(groups.recall('controlGroup3', () => true, ALL_UNITS)).toEqual([8]);
  });

  it('Ctrl-replaces only the target group without stealing its members from others', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    groups.replace('controlGroup2', [2, 3]);

    expect(groups.recall('controlGroup1', () => true, ALL_UNITS)).toEqual([1, 2]);
    expect(groups.recall('controlGroup2', () => true, ALL_UNITS)).toEqual([2, 3]);
  });

  it('overwrites and clears a group with the current selection', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    groups.replace('controlGroup1', [9]);
    expect(groups.recall('controlGroup1', () => true, ALL_UNITS)).toEqual([9]);

    groups.replace('controlGroup1', []);
    expect(groups.recall('controlGroup1', () => true, ALL_UNITS)).toBeNull();
  });

  it('recalls a lone building, but only the units of stored members that mix them', () => {
    const BARRACKS = 2;
    const isUnit = (id: number): boolean => id !== BARRACKS;
    const groups = createControlGroups();
    groups.replace('controlGroup1', [BARRACKS]);
    groups.replace('controlGroup2', [1, BARRACKS, 3]);

    expect(groups.recall('controlGroup1', () => true, isUnit)).toEqual([BARRACKS]);
    expect(groups.recall('controlGroup2', () => true, isUnit)).toEqual([1, 3]);
  });

  it('forgets invalid members and leaves selection unchanged when none remain', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    expect(groups.recall('controlGroup1', (id) => id === 2, ALL_UNITS)).toEqual([2]);
    expect(groups.recall('controlGroup1', () => false, ALL_UNITS)).toBeNull();
    expect(groups.recall('controlGroup1', () => true, ALL_UNITS)).toBeNull();
  });
});

describe('group numbers on the map', () => {
  it('numbers the members of groups 1-3 only, the lowest group winning', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1]);
    groups.replace('controlGroup2', [2, 1]);
    groups.replace('controlGroup3', [3]);
    groups.replace('controlGroup4', [4]);

    expect([...groups.numbers()]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('keeps one map until a group changes, then follows a steal and a forgotten member', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    const first = groups.numbers();
    expect(groups.numbers()).toBe(first);

    groups.addExclusive('controlGroup2', [2]);
    expect(groups.numbers().get(2)).toBe(2);

    groups.recall('controlGroup1', (id) => id !== 1, ALL_UNITS);
    expect(groups.numbers().has(1)).toBe(false);
  });
});

describe('recall of an already selected group', () => {
  it('centres only for the exact group; a partial or wider selection selects', () => {
    expect(groupRecallEffect([1, 2], new Set([1, 2]))).toBe('centre');
    expect(groupRecallEffect([1, 2], new Set([1, 2, 3]))).toBe('select');
    expect(groupRecallEffect([1, 2], new Set([1]))).toBe('select');
    expect(groupRecallEffect([1, 2], new Set())).toBe('select');
  });

  it('centres on the mean ground anchor of the positioned members', () => {
    const snapshot = snapshotOf([
      settler(1, 6, null), // no Position: contributes nothing
      { id: 2, components: { Settler: {}, Position: { x: fx.fromInt(2), y: fx.fromInt(4) } } },
      { id: 3, components: { Settler: {}, Position: { x: fx.fromInt(6), y: fx.fromInt(8) } } },
    ]);
    const a = tileToScreen(2, 4);
    const b = tileToScreen(6, 8);

    expect(groupCentre(snapshot, [1, 2, 3])).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    expect(groupCentre(snapshot, [1])).toBeNull();
  });

  it('centres a lone building group on the building', () => {
    const snapshot = snapshotOf([building(2, 1, 2, 4)]);
    expect(groupCentre(snapshot, [2])).toEqual(tileToScreen(2, 4));
  });
});
