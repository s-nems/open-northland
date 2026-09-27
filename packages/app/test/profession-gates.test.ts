import { fx, type PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
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
    await Promise.resolve();
    await Promise.resolve();

    expect(orders).toEqual([{ kind: 'setJob', entity: 2, jobType: JOB_HUNTER }]);
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
