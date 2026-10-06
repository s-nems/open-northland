import { fx, MAX_UNIT_ORDER_MEMBERS, type PlayerCommand } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { JOB_COLLECTOR, JOB_HUNTER } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { createAnsweredOrders } from '../src/view/unit-controls/answered-orders.js';
import { professionGates } from '../src/view/unit-controls/profession-gates.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const content = sandboxContent();
const TRIBE = 1;

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
  it('submits 1000 freshly eligible settlers as one selection action', async () => {
    const orders: PlayerCommand[] = [];
    const settlers = Array.from({ length: 1000 }, (_, i) => collector(i + 1));
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
