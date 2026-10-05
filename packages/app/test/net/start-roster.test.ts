import type { RoomView, WaitedMember } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { playerSwatchHex } from '../../src/catalog/roster.js';
import { type StartRosterInputs, startRosterRows } from '../../src/view/net/start-roster.js';

const ROOM = {
  id: 'r',
  state: 'running',
  creator: 'Ania',
  members: [
    { nick: 'Bartek', seat: 2, connected: true, compatibility: null, load: null, loading: 40 },
    { nick: 'Ania', seat: 0, connected: true, compatibility: null, load: null, loading: 10 },
    { nick: 'Celina', seat: 1, connected: false, compatibility: null, load: null, loading: null },
    { nick: 'Widz', seat: null, connected: true, compatibility: null, load: null, loading: null },
  ],
  seats: [
    { player: 0, color: 3 },
    { player: 1, color: 5 },
    { player: 2, color: 7 },
  ],
} as unknown as RoomView;

const waited = (nick: string, reason: WaitedMember['reason']): WaitedMember => ({
  nick,
  reason,
  voteAfterMs: 0,
});

function rows(over: Partial<StartRosterInputs> = {}) {
  return startRosterRows({
    room: ROOM,
    waitingFor: [waited('Bartek', 'loading'), waited('Ania', 'loading'), waited('Celina', 'gone')],
    heardWaiting: true,
    ownNick: 'Ania',
    ownProgress: 60,
    ...over,
  });
}

describe('start roster', () => {
  it('lists the seated players in seat order with their colour, state and progress', () => {
    expect(rows()).toEqual([
      { nick: 'Ania', color: playerSwatchHex(3), self: true, state: 'loading', progress: 60 },
      { nick: 'Celina', color: playerSwatchHex(5), self: false, state: 'away', progress: null },
      { nick: 'Bartek', color: playerSwatchHex(7), self: false, state: 'loading', progress: 40 },
    ]);
  });

  it('reads a player nobody waits for as ready, but only once the relay said who it waits for', () => {
    expect(rows({ waitingFor: [] }).map((row) => row.state)).toEqual(['ready', 'ready', 'ready']);
    expect(rows({ waitingFor: [], heardWaiting: false }).map((row) => row.state)).toEqual([
      'loading',
      'loading',
      'loading',
    ]);
  });
});
