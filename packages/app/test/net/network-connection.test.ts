import type { GameSession } from '@open-northland/lockstep';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkConnection } from '../../src/net/connection.js';

class Socket {
  readonly OPEN = 1;
  readyState = 0;
  close(): void {
    this.readyState = 3;
  }
  send(): void {}
}
const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
afterEach(() => vi.unstubAllGlobals());

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
});
