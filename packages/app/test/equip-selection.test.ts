import {
  type Entity,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { beforeEach, expect, it, vi } from 'vitest';
import { uiStringLookup } from '../src/content/gui-gfx.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

const picker = vi.hoisted(() => ({ rows: [] as Array<() => void> }));
vi.mock('../src/content/ui-font.js', () => ({ loadUiFont: async () => ({ family: 'test' }) }));
vi.mock('../src/view/unit-controls/picker-window.js', () => ({
  createPickerWindow: () => ({
    setTitle: () => {},
    clearList: () => {
      picker.rows.length = 0;
    },
    addRow: (_label: string, pick: () => void) => {
      picker.rows.push(pick);
    },
    addNote: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
}));
// The app tests share a module registry; install the picker substitutes before loading its consumer.
vi.resetModules();
const { mountEquipPicker } = await import('../src/view/unit-controls/equip-picker.js');

beforeEach(() => {
  picker.rows.length = 0;
});

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
  const controller = await mountEquipPicker({
    content,
    uiString: uiStringLookup(null),
    snapshot: () => snapshot,
    pickList,
    selectionPicks,
    enqueue: (command) => orders.push(command),
  });
  controller.openAll(selected);
  await vi.waitFor(() => expect(picker.rows).toHaveLength(1));
  expect(selectionPicks).toHaveBeenCalledExactlyOnceWith(selected);
  expect(pickList).not.toHaveBeenCalled();
  snapshot = state(1000, 1);
  picker.rows[0]?.();
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

it('refuses oversized equipment selections before querying or submitting', async () => {
  const snapshot = state(MAX_UNIT_ORDER_MEMBERS + 1, 0);
  const pickList = vi.fn(async () => []),
    selectionPicks = vi.fn(async () => []),
    enqueue = vi.fn(),
    onOrderLimit = vi.fn();
  const controller = await mountEquipPicker({
    content: sandboxContent(),
    uiString: uiStringLookup(null),
    snapshot: () => snapshot,
    pickList,
    selectionPicks,
    enqueue,
    onOrderLimit,
  });
  controller.openAll(snapshot.entities.map(({ id }) => id));
  expect(pickList).not.toHaveBeenCalled();
  expect(selectionPicks).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  expect(onOrderLimit).toHaveBeenCalledOnce();
  controller.dispose();
});
