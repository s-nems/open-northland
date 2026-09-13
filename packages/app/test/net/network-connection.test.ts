import type { GameSession } from '@open-northland/lockstep';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkConnection } from '../../src/net/connection.js';

class Socket {
  static sent: string[] = [];
  readonly OPEN = 1;
  readyState = 1;
  close(): void {
    this.readyState = 3;
  }
  send(raw: string): void {
    Socket.sent.push(raw);
  }
}
const ROOM = {
  id: 'r',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'Room',
    world: { kind: 'map', mapId: 'forest' },
    seed: 1,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  },
  seats: [{ player: 0, mode: 'human', color: 0, nick: 'Ania', ready: true }],
  members: [{ nick: 'Ania', seat: 0, connected: true, compatibility: null }],
} as const;
const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
afterEach(() => {
  vi.unstubAllGlobals();
  Socket.sent = [];
});

describe('network connection disposal', () => {
  it('does not call a bound world port after disposal wins the pending await', async () => {
    vi.stubGlobal('WebSocket', Socket);
    const connection = new NetworkConnection('ws://example.test', {
      token: 'token-0123456789abcdef',
      nick: 'Ania',
    });
    const open = vi.fn(async () => null);
    const restore = vi.fn(async () => null);
    connection.client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    connection.bindWorld({ open, restore }, vi.fn());
    connection.dispose();
    await connection.client.settled();
    expect(open).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(connection.client.session).toBeNull();
  });

  it('releases an unbound pending port and ignores a later bind', async () => {
    vi.stubGlobal('WebSocket', Socket);
    const connection = new NetworkConnection('ws://example.test', {
      token: 'token-0123456789abcdef',
      nick: 'Ania',
    });
    connection.client.receive({ kind: 'start', session: SESSION, snapshotTick: null });
    connection.dispose();
    const open = vi.fn(async () => null);
    connection.bindWorld({ open, restore: async () => null }, vi.fn());
    await connection.client.settled();
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves the room on disposal unless told to keep the seat for a reconnect', () => {
    vi.stubGlobal('WebSocket', Socket);
    for (const leave of [true, false]) {
      const connection = new NetworkConnection('ws://example.test', {
        token: 'token-0123456789abcdef',
        nick: 'Ania',
      });
      connection.client.receive({ kind: 'room', room: ROOM });
      Socket.sent = [];
      connection.dispose(leave);
      expect(Socket.sent.map((raw) => JSON.parse(raw).kind)).toEqual(leave ? ['leaveRoom'] : []);
      expect(connection.client.room).toBeNull();
    }
  });
});
