import { fx, MAX_UNIT_ORDER_MEMBERS, type PlayerCommand } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { JOB_COLLECTOR, JOB_HUNTER } from '../../../../src/catalog/jobs.js';
import { GOOD_GOLD as GOLD, GOOD_WOOD as WOOD } from '../../../../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import { professionGates } from '../../../../src/view/unit-controls/orders/profession-gates.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

const content = sandboxContent();
const TRIBE = 1;
/** More than one settler, so the picks go out as one group action. */
const GROUP_SIZE = 3;
const OPEN = { allowed: true, enabled: true, enablingJobs: [], requiredJobs: [], requiredGoods: [] };

function collector(id: number): Ent {
  return {
    id,
    components: {
      Settler: { jobType: JOB_COLLECTOR, tribe: TRIBE },
      Position: { x: fx.fromInt(id), y: fx.fromInt(id) },
    },
  };
}

const snapshot = snapshotOf([collector(1), collector(2)]);

describe('profession pick', () => {
  it('submits several freshly eligible settlers as one selection action', async () => {
    const orders: PlayerCommand[] = [];
    const settlers = Array.from({ length: GROUP_SIZE }, (_, i) => collector(i + 1));
    const gates = professionGates({
      content,
      snapshot: () => snapshotOf(settlers),
      canChooseJob: () => false,
      askCanChooseJob: () => Promise.resolve(true),
      answered: createAnsweredOrders(),
      enqueue: (command) => orders.push(command),
    });
    gates.onSetJob(
      settlers.map(({ id }) => id),
      JOB_HUNTER,
    );
    await vi.waitFor(() => expect(orders).toHaveLength(1));
    expect(orders[0]).toEqual({
      kind: 'unitActionGroup',
      members: settlers.map(({ id: entity }) => ({ entity })),
      action: { kind: 'setJob', jobType: JOB_HUNTER },
    });
  });

  it('rejects an oversized selection before asking or submitting any profession changes', () => {
    const settlers = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => collector(i + 1));
    const askCanChooseJob = vi.fn(() => Promise.resolve(true)),
      enqueue = vi.fn(),
      onOrderLimit = vi.fn();
    professionGates({
      content,
      snapshot: () => snapshotOf(settlers),
      canChooseJob: () => true,
      askCanChooseJob,
      answered: createAnsweredOrders(),
      enqueue,
      onOrderLimit,
    }).onSetJob(
      settlers.map(({ id }) => id),
      JOB_HUNTER,
    );
    expect(askCanChooseJob).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(onOrderLimit).toHaveBeenCalledOnce();
  });

  it('orders the settlers the host lets take the trade as of the pick, not by the last answer', async () => {
    const orders: PlayerCommand[] = [];
    // The list drew before any answer landed; by the pick, the host lets settler 2 take it.
    const gates = professionGates({
      content,
      snapshot: () => snapshot,
      canChooseJob: () => false,
      askCanChooseJob: (entity) => Promise.resolve(entity === 2),
      answered: createAnsweredOrders(),
      enqueue: (command) => orders.push(command),
    });

    gates.onSetJob([1, 2], JOB_HUNTER);
    expect(orders).toEqual([]);

    await vi.waitFor(() => expect(orders).toEqual([{ kind: 'setJob', entity: 2, jobType: JOB_HUNTER }]));
  });

  it('orders nothing once the controls are gone', async () => {
    const orders: PlayerCommand[] = [];
    const answered = createAnsweredOrders();
    const gates = professionGates({
      content,
      snapshot: () => snapshot,
      canChooseJob: () => true,
      askCanChooseJob: () => Promise.resolve(true),
      answered,
      enqueue: (command) => orders.push(command),
    });

    gates.onSetJob([1, 2], JOB_HUNTER);
    answered.dispose();
    await Promise.resolve();
    await Promise.resolve();

    expect(orders).toEqual([]);
  });
});

describe('gathering goods page', () => {
  const gates = professionGates({
    content,
    snapshot: () => snapshot,
    canChooseJob: () => true,
    askCanChooseJob: () => Promise.resolve(true),
    technologyStatus: (kind, typeId) =>
      kind === 'good' && typeId === GOLD ? { ...OPEN, allowed: false } : OPEN,
    answered: createAnsweredOrders(),
    enqueue: () => undefined,
  });

  it('offers the goods a gatherer may be held to, without one the mission forbids', () => {
    expect(gates.jobGoods([1, 2], JOB_COLLECTOR).map((good) => good.goodId)).toEqual([
      'wood',
      'stone',
      'mud',
      'iron',
      'mushroom',
    ]);
  });

  it('offers no page for a trade whose production the player cannot set', () => {
    expect(gates.jobGoods([1, 2], JOB_HUNTER)).toEqual([]);
  });

  it('holds to the picked good only the settlers who may gather it; the rest gather everything', async () => {
    const BARRED_SEAT = 1;
    const settlers = [1, 2].map((id) => ({
      ...collector(id),
      components: { ...collector(id).components, Owner: { player: id === 2 ? BARRED_SEAT : 0 } },
    }));
    const orders: PlayerCommand[] = [];
    professionGates({
      content,
      snapshot: () => snapshotOf(settlers),
      canChooseJob: () => true,
      askCanChooseJob: () => Promise.resolve(true),
      technologyStatus: (kind, typeId, _tribe, player) =>
        kind === 'good' && typeId === GOLD && player === BARRED_SEAT ? { ...OPEN, allowed: false } : OPEN,
      answered: createAnsweredOrders(),
      enqueue: (command) => orders.push(command),
    }).onSetJob([1, 2], JOB_COLLECTOR, [GOLD]);
    await vi.waitFor(() => expect(orders).toHaveLength(1));
    expect(orders[0]).toEqual({
      kind: 'unitOrdersGroup',
      members: [
        { entity: 1, actions: [{ kind: 'setJob', jobType: JOB_COLLECTOR, goods: [GOLD] }] },
        { entity: 2, actions: [{ kind: 'setJob', jobType: JOB_COLLECTOR, goods: [] }] },
      ],
    });
  });

  it('holds the new trade to the picked good', async () => {
    const orders: PlayerCommand[] = [];
    professionGates({
      content,
      snapshot: () => snapshot,
      canChooseJob: () => true,
      askCanChooseJob: (entity) => Promise.resolve(entity === 1),
      answered: createAnsweredOrders(),
      enqueue: (command) => orders.push(command),
    }).onSetJob([1, 2], JOB_COLLECTOR, [WOOD]);
    await vi.waitFor(() =>
      expect(orders).toEqual([{ kind: 'setJob', entity: 1, jobType: JOB_COLLECTOR, goods: [WOOD] }]),
    );
  });
});
