import { MAX_UNIT_ORDER_MEMBERS, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import { beforeEach, expect, it, vi } from 'vitest';
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

it('submits one equipment gesture with each of 1000 current misc slots intact', async () => {
  const content = sandboxContent(),
    good = content.goods.find((row) => row.equip?.category === 'misc');
  if (good === undefined) throw new Error('missing misc equipment');
  let snapshot = state(1000, 0);
  const orders: PlayerCommand[] = [];
  const controller = await mountEquipPicker({
    content,
    snapshot: () => snapshot,
    pickList: async (_entity, group) =>
      group === 'misc' ? [{ goodType: good.typeId, available: 2000 }] : [],
    enqueue: (command) => orders.push(command),
  });
  controller.openAll(snapshot.entities.map(({ id }) => id));
  await vi.waitFor(() => expect(picker.rows).toHaveLength(1));
  snapshot = state(1000, 1);
  picker.rows[0]?.();
  expect(orders).toEqual([
    {
      kind: 'unitOrdersGroup',
      members: snapshot.entities.map(({ id: entity }, i) => ({
        entity,
        actions: [{ kind: 'equipGood', group: 'misc', slot: (i + 1) % 4, goodType: good.typeId }],
      })),
    },
  ]);
  controller.dispose();
});

it('refuses oversized equipment selections before querying or submitting', async () => {
  const snapshot = state(MAX_UNIT_ORDER_MEMBERS + 1, 0);
  const pickList = vi.fn(async () => []),
    enqueue = vi.fn(),
    onOrderLimit = vi.fn();
  const controller = await mountEquipPicker({
    content: sandboxContent(),
    snapshot: () => snapshot,
    pickList,
    enqueue,
    onOrderLimit,
  });
  controller.openAll(snapshot.entities.map(({ id }) => id));
  expect(pickList).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  expect(onOrderLimit).toHaveBeenCalledOnce();
  controller.dispose();
});
