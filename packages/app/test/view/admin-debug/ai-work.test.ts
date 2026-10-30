import { type Entity, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import { readSeatWork, workTables } from '../../../src/view/admin-debug/ai-work.js';

const msgs = messages();
const copy = msgs.admin.ai;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const CARRIER = 1;
const RAIDER = 5;
const APPRENTICE = 6;

const carrier = {
  id: CARRIER,
  components: {
    ComputerOperations: {
      nextId: 4,
      readyAt: { assault: 0, hold: 0, raid: 0 },
      operations: [
        {
          id: 1,
          kind: 'assault',
          state: 'moving',
          since: 0,
          members: [RAIDER],
          target: { hx: 10, hy: 12, entity: null, owner: 3 },
          reason: null,
        },
        {
          id: 2,
          kind: 'raid',
          state: 'failed',
          since: TICKS_PER_MINUTE,
          members: [],
          target: { hx: 4, hy: 6, entity: 99, owner: null },
          reason: 'wiped',
          waypoints: [],
          leg: 0,
          startMen: 2,
          struck: [],
          killed: 0,
        },
        {
          id: 3,
          kind: 'hold',
          state: 'acting',
          since: TICKS_PER_MINUTE,
          members: [RAIDER],
          target: { hx: 179, hy: 179, entity: null, owner: null },
          reason: null,
          range: 13,
          post: { hx: 179, hy: 179 },
          sentMen: 1,
        },
      ],
    },
  },
};

const snapshot: WorldSnapshot = {
  tick: 2 * TICKS_PER_MINUTE,
  events: [],
  entities: [carrier, { id: APPRENTICE, components: { Settler: { jobType: 7 } } }],
};

describe('a computer seat at work', () => {
  it('lists its operations with their age in state and its apprentices once the sim answered', () => {
    const work = readSeatWork(snapshot, carrier, null, [
      { kind: 'job', typeId: 12, opens: 'work_smithy', man: APPRENTICE as Entity, repeats: 4 },
      { kind: 'good', typeId: 3, opens: 'iron', man: null, repeats: 0 },
    ]);
    const [operations, apprentices] = workTables(work, msgs);
    expect(operations?.rows).toEqual([
      [
        '#1 assault',
        'moving',
        '1',
        copy.place,
        formatMessage(copy.player, { player: 3 }),
        '10,12',
        '2.0',
        '-',
      ],
      // A target gone from the world shows as a bare unit.
      ['#2 raid', 'failed', '0', copy.unit, '-', '4,6', '1.0', 'wiped'],
      // A hold aims at a place and shows its radius.
      ['#3 hold', 'acting', '1', copy.place, '-', '179,179 r13', '1.0', '-'],
    ]);
    expect(apprentices?.rows).toEqual([
      ['12', 'work_smithy', '#6 7', '4'],
      ['3', 'iron', '-', '0'],
    ]);
  });

  it('shows no table for a seat without operations before the apprentice answer lands', () => {
    expect(workTables(readSeatWork(snapshot, { id: 2, components: {} }, null, undefined), msgs)).toEqual([]);
  });
});
