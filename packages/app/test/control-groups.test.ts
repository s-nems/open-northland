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
  it('recalls owned actors off-screen but rejects foreign, neutral, and livestock refs', () => {
    const snapshot = snapshotOf([
      { id: 1, components: { Settler: {}, Owner: { player: 0 } } },
      { id: 2, components: { Building: {}, Owner: { player: 0 } } },
      { id: 3, components: { Settler: {}, Owner: { player: 1 } } },
      { id: 4, components: { Settler: {} } },
      { id: 5, components: { Settler: {}, Livestock: {}, Owner: { player: 0 } } },
    ]);

    expect(isControlGroupMember(snapshot, 1, 0, false)).toBe(true);
    expect(isControlGroupMember(snapshot, 2, 0, false)).toBe(true);
    expect(isControlGroupMember(snapshot, 3, 0, false)).toBe(false);
    expect(isControlGroupMember(snapshot, 3, 0, true)).toBe(true);
    expect(isControlGroupMember(snapshot, 4, 0, true)).toBe(false);
    expect(isControlGroupMember(snapshot, 5, 0, true)).toBe(false);
    expect(isControlGroupMember(snapshot, 99, 0, true)).toBe(false);
  });

  it('Shift-adds members in insertion order and steals them from every other group', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [4, 2]);
    groups.replace('controlGroup2', [7, 9]);
    groups.replace('controlGroup3', [2, 8]);
    groups.addExclusive('controlGroup2', [2, 7]);

    expect(groups.recall('controlGroup1', () => true)).toEqual([4]);
    expect(groups.recall('controlGroup2', () => true)).toEqual([7, 9, 2]);
    expect(groups.recall('controlGroup3', () => true)).toEqual([8]);
  });

  it('Ctrl-replaces only the target group without stealing its members from others', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    groups.replace('controlGroup2', [2, 3]);

    expect(groups.recall('controlGroup1', () => true)).toEqual([1, 2]);
    expect(groups.recall('controlGroup2', () => true)).toEqual([2, 3]);
  });

  it('overwrites and clears a group with the current selection', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    groups.replace('controlGroup1', [9]);
    expect(groups.recall('controlGroup1', () => true)).toEqual([9]);

    groups.replace('controlGroup1', []);
    expect(groups.recall('controlGroup1', () => true)).toBeNull();
  });

  it('forgets invalid members and leaves selection unchanged when none remain', () => {
    const groups = createControlGroups();
    groups.replace('controlGroup1', [1, 2]);
    expect(groups.recall('controlGroup1', (id) => id === 2)).toEqual([2]);
    expect(groups.recall('controlGroup1', () => false)).toBeNull();
    expect(groups.recall('controlGroup1', () => true)).toBeNull();
  });
});

describe('recall of an already selected group', () => {
  it('centres only for the exact group; a partial or wider selection selects', () => {
    expect(groupRecallEffect([1, 2], new Set([1, 2]))).toBe('centre');
    expect(groupRecallEffect([1, 2], new Set([1, 2, 3]))).toBe('select');
    expect(groupRecallEffect([1, 2], new Set([1]))).toBe('select');
    expect(groupRecallEffect([1, 2], new Set())).toBe('select');
  });

  it('centres on the mean ground anchor of the positioned members, buildings included', () => {
    const snapshot = snapshotOf([
      settler(1, 6, null), // no Position: contributes nothing
      building(2, 1, 2, 4),
      { id: 3, components: { Settler: {}, Position: { x: fx.fromInt(6), y: fx.fromInt(8) } } },
    ]);
    const a = tileToScreen(2, 4);
    const b = tileToScreen(6, 8);

    expect(groupCentre(snapshot, [1, 2, 3])).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    expect(groupCentre(snapshot, [1])).toBeNull();
  });
});
