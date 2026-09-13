import { type LobbyCompatibility, PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { lobbyCompatibilityReporter } from '../../src/entries/relay/compatibility.js';

const REPORT: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'test',
  protocol: PROTOCOL_VERSION,
};

function room(id: string, compatibility: LobbyCompatibility | null = null): RoomView {
  return {
    id,
    state: 'lobby',
    creator: 'Ania',
    settings: {
      name: id,
      world: { kind: 'map', mapId: id },
      seed: 1,
      rules: { fog: null, progression: null, needs: null },
      speed: 1,
    },
    seats: [{ player: 0, mode: 'human', color: 0, nick: 'Ania', ready: false }],
    members: [{ nick: 'Ania', seat: 0, connected: true, compatibility }],
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('lobby compatibility reporter', () => {
  it('resends a cached report after a lost send, and stops once the relay acknowledges it', async () => {
    const client = { nick: 'Ania', room: room('first'), setCompatibility: vi.fn() };
    const load = vi.fn(async () => REPORT);
    const reporter = lobbyCompatibilityReporter(client, vi.fn(), load);
    reporter.observe(client.room);
    await settle();
    expect(client.setCompatibility).toHaveBeenCalledTimes(1);
    reporter.observe(client.room);
    expect(client.setCompatibility).toHaveBeenCalledTimes(2);
    client.room = room('first', REPORT);
    reporter.observe(client.room);
    expect(client.setCompatibility).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('allows a later room view to retry a failed load', async () => {
    const client = { nick: 'Ania', room: room('first'), setCompatibility: vi.fn() };
    const error = new Error('offline');
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(REPORT);
    const failed = vi.fn();
    const reporter = lobbyCompatibilityReporter(client, failed, load);
    reporter.observe(client.room);
    await settle();
    expect(failed).toHaveBeenCalledWith(error);
    reporter.observe(client.room);
    await settle();
    expect(client.setCompatibility).toHaveBeenCalledWith(REPORT);
  });

  it('ignores stale room loads even when returning to the same room id', async () => {
    const client = { nick: 'Ania', room: room('first'), setCompatibility: vi.fn() };
    let release: (value: LobbyCompatibility) => void = () => undefined;
    const first = new Promise<LobbyCompatibility>((resolve) => {
      release = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(first).mockResolvedValue(REPORT);
    const reporter = lobbyCompatibilityReporter(client, vi.fn(), load);
    reporter.observe(client.room);
    client.room = room('second');
    reporter.observe(client.room);
    client.room = room('first');
    reporter.observe(client.room);
    await settle();
    release({ ...REPORT, client: 'stale' });
    await settle();
    expect(client.setCompatibility.mock.calls).toEqual([[REPORT]]);
  });
});
