import type { RoomState, RoomSummary } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatPlayed,
  hallRooms,
  onlineRows,
} from '../../../../../src/entries/main-menu/network/hall/model.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function room(id: string, name: string, state: RoomState = 'lobby'): RoomSummary {
  return {
    id,
    name,
    state,
    members: ['Ania'],
    seats: 4,
    world: { kind: 'map', mapId: 'magiczny_las' },
    locked: false,
    playedMs: null,
  };
}

describe('server hall', () => {
  it('splits joinable rooms from running games and leaves ended and abandoned ones out', () => {
    const { open, running } = hallRooms([
      room('a', 'Lobby'),
      room('b', 'Game', 'running'),
      room('c', 'Over', 'ended'),
      { ...room('d', 'Abandoned', 'running'), members: [] },
    ]);
    expect(open.map((entry) => entry.id)).toEqual(['a']);
    expect(running.map((entry) => entry.id)).toEqual(['b']);
  });

  it('orders rooms by the name they show, the id breaking a tie', () => {
    const { open } = hallRooms([
      room('f3', 'Zamek'),
      room('a1', 'Bitwa 10'),
      room('c2', 'Bitwa 2'),
      room('0e', 'Zamek'),
    ]);
    expect(open.map((entry) => entry.id)).toEqual(['c2', 'a1', '0e', 'f3']);
  });

  it('lists the player first, then those looking for a game, then those in rooms', () => {
    const rows = onlineRows(
      [
        { nick: 'Emil', room: 'g' },
        { nick: 'Bartek', room: 'l' },
        { nick: 'Space', room: null },
        { nick: 'Ania', room: null },
        { nick: 'Celina', room: 'gone' },
      ],
      [room('l', 'Lobby'), room('g', 'Game', 'running')],
      'Space',
    );
    expect(rows.map((row) => [row.nick, row.where])).toEqual([
      ['Space', { kind: 'hall' }],
      ['Ania', { kind: 'hall' }],
      ['Celina', { kind: 'hall' }],
      ['Bartek', { kind: 'lobby', room: 'Lobby' }],
      ['Emil', { kind: 'playing', room: 'Game' }],
    ]);
  });

  it('reads a running clock as minutes, then hours', () => {
    expect(formatPlayed(59_999)).toBe('0:59');
    expect(formatPlayed(42 * MINUTE_MS + 7_000)).toBe('42:07');
    expect(formatPlayed(HOUR_MS + 2 * MINUTE_MS + 3_000)).toBe('1:02:03');
  });

  it('words an absence in its largest whole unit, under a minute as none', () => {
    const now = 10 * 24 * HOUR_MS;
    expect(formatAgo(now - 30_000, now, 'en')).toBeNull();
    expect(formatAgo(now - 5 * MINUTE_MS, now, 'en')).toBe('5 minutes ago');
    expect(formatAgo(now - 3 * HOUR_MS - MINUTE_MS, now, 'en')).toBe('3 hours ago');
    expect(formatAgo(now - 2 * 24 * HOUR_MS, now, 'en')).toBe('2 days ago');
  });
});
