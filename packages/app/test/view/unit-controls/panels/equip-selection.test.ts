import type { Entity, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { beforeEach, expect, it, vi } from 'vitest';
import { uiStringLookup } from '../../../../src/content/gui/gfx.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { ChoiceGroup } from '../../../../src/hud/dom/choice-window.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

const picker = vi.hoisted(() => ({
  groups: [] as ChoiceGroup[],
  pick: undefined as ((key: string, event: MouseEvent) => void) | undefined,
}));
vi.mock('../../../../src/hud/dom/choice-window.js', () => ({
  createChoiceWindow: (opts: { onPick: (key: string, event: MouseEvent) => void }) => {
    picker.pick = opts.onPick;
    return {
      update: (groups: ChoiceGroup[]) => {
        picker.groups = groups;
      },
      show: () => {},
      hide: () => {},
      setUiScale: async () => {},
      dispose: () => {},
    };
  },
}));
// The app tests share a module registry; install the window substitute before loading its consumer.
vi.resetModules();
const { mountEquipPicker } = await import('../../../../src/view/unit-controls/panels/equip-picker.js');

beforeEach(() => {
  picker.groups = [];
  picker.pick = undefined;
});

const shell = { uiString: uiStringLookup(null), scale: () => 1, camera: STILL_CAMERA, icons: () => {} };
const plainClick = { shiftKey: false } as MouseEvent;
const shiftClick = { shiftKey: true } as MouseEvent;

function state(count: number, slot: number): WorldSnapshot {
  return {
    tick: slot,
    events: [],
    entities: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      components: {
        Equipment: { misc: Array.from({ length: 4 }, (_, index) => (index === (i + slot) % 4 ? null : {})) },
      },
    })),
  };
}

it('asks the sim once for the selection and submits one gesture to the takers, misc slots intact', async () => {
  const content = sandboxContent(),
    good = content.goods.find((row) => row.equip?.category === 'misc');
  if (good === undefined) throw new Error('missing misc equipment');
  let snapshot = state(1000, 0);
  const selected = snapshot.entities.map(({ id }) => id);
  const takers = selected.filter((id) => id % 2 === 1); // the sim's answer: only every other settler can
  const orders: PlayerCommand[] = [];
  const selectionPicks = vi.fn(async (_entities: readonly number[]) => [
    { goodType: good.typeId, group: 'misc' as const, available: 2000, takers: takers as Entity[] },
  ]);
  const pickList = vi.fn(async () => []);
  const controller = mountEquipPicker({
    ...shell,
    content,
    snapshot: () => snapshot,
    pickList,
    selectionPicks,
    enqueue: (command) => orders.push(command),
  });
  controller.openAll(selected);
  await vi.waitFor(() => expect(picker.groups.flatMap((group) => group.rows)).toHaveLength(1));
  expect(selectionPicks).toHaveBeenCalledExactlyOnceWith(selected);
  expect(pickList).not.toHaveBeenCalled();
  snapshot = state(1000, 1);
  picker.pick?.(String(good.typeId), plainClick);
  expect(orders).toEqual([
    {
      kind: 'unitOrdersGroup',
      members: takers.map((entity) => ({
        entity,
        actions: [{ kind: 'equipGood', group: 'misc', slot: entity % 4, goodType: good.typeId }],
      })),
    },
  ]);
  controller.dispose();
});

it('groups the selection window by slot and equips a slot window pick into that slot', async () => {
  const content = sandboxContent();
  const byCategory = (category: string) => content.goods.find((row) => row.equip?.category === category);
  const weapon = byCategory('weapon'),
    misc = byCategory('misc');
  if (weapon === undefined || misc === undefined) throw new Error('missing equipment goods');
  const snapshot = state(2, 0);
  const orders: PlayerCommand[] = [];
  const controller = mountEquipPicker({
    ...shell,
    content,
    snapshot: () => snapshot,
    pickList: async () => [{ goodType: weapon.typeId, available: 3 }],
    selectionPicks: async () => [
      { goodType: misc.typeId, group: 'misc' as const, available: 5, takers: [1 as Entity] },
      { goodType: weapon.typeId, group: 'weapon' as const, available: 3, takers: [1, 2] as Entity[] },
    ],
    enqueue: (command) => orders.push(command),
  });
  controller.openAll([1, 2]);
  await vi.waitFor(() => expect(picker.groups).toHaveLength(2));
  expect(picker.groups.map((group) => group.rows.map((row) => row.key))).toEqual([
    [String(weapon.typeId)],
    [String(misc.typeId)],
  ]);
  expect(picker.groups[1]?.rows[0]).toMatchObject({ goodId: misc.id, detail: '5' });

  controller.open(2, { group: 'weapon', slot: 0 });
  await vi.waitFor(() => expect(picker.groups).toHaveLength(1));
  picker.pick?.(String(weapon.typeId), plainClick);
  expect(orders).toEqual([
    { kind: 'equipGood', entity: 2, group: 'weapon', slot: 0, goodType: weapon.typeId },
  ]);

  // A Shift pick queues the put-on behind the settler's current order, in either window.
  orders.length = 0;
  controller.open(2, { group: 'weapon', slot: 0 });
  await vi.waitFor(() => expect(picker.groups).toHaveLength(1));
  picker.pick?.(String(weapon.typeId), shiftClick);
  controller.openAll([1, 2]);
  await vi.waitFor(() => expect(picker.groups).toHaveLength(2));
  picker.pick?.(String(weapon.typeId), shiftClick);
  expect(orders).toMatchObject([
    { kind: 'equipGood', entity: 2, group: 'weapon', slot: 0, goodType: weapon.typeId, queued: true },
    {
      kind: 'unitActionGroup',
      members: [{ entity: 1 }, { entity: 2 }],
      action: { kind: 'equipGood', queued: true },
    },
  ]);
  controller.dispose();
});
