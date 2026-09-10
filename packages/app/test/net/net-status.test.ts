import type { RoomView } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { memberRows } from '../../src/view/net/net-status.js';
import { waitedRows } from '../../src/view/net/waiting-overlay.js';

const ROOM: RoomView = {
  id: 'r1',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'las',
    world: { kind: 'map', mapId: 'las' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  },
  seats: [],
  members: [
    { nick: 'Ania', seat: 1, connected: true },
    { nick: 'Bartek', seat: 2, connected: true },
    { nick: 'Celina', seat: 3, connected: false },
  ],
};

describe('memberRows', () => {
  it('reads each member from the wait list first, then from the connection flag', () => {
    const rows = memberRows(ROOM, [{ nick: 'Bartek', reason: 'lagging', voteAfterMs: 1000 }], 'Ania');
    expect(rows).toEqual([
      { nick: 'Ania', seat: 1, status: 'ok', self: true },
      { nick: 'Bartek', seat: 2, status: 'lagging', self: false },
      { nick: 'Celina', seat: 3, status: 'gone', self: false },
    ]);
  });

  it('lists nobody before a room', () => {
    expect(memberRows(null, [], 'Ania')).toEqual([]);
  });
});

describe('waitedRows', () => {
  it('counts each member down from the moment the notice arrived, in whole seconds, to zero', () => {
    const waited = [
      { nick: 'Bartek', reason: 'gone', voteAfterMs: 4500 },
      { nick: 'Celina', reason: 'silent', voteAfterMs: 0 },
    ] as const;
    expect(waitedRows(waited, 1000, 1000)).toEqual([
      { nick: 'Bartek', reason: 'gone', voteInSeconds: 5 },
      { nick: 'Celina', reason: 'silent', voteInSeconds: 0 },
    ]);
    expect(waitedRows(waited, 1000, 4600)[0]?.voteInSeconds).toBe(1);
    expect(waitedRows(waited, 1000, 9000)[0]?.voteInSeconds).toBe(0);
  });
});
