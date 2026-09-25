import { type GameSession, parseSavedSessionMetadata } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD } from '@open-northland/net-protocol';
import { exportSaveGame, Simulation } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';
import { networkSaveSession } from '../../src/net/save-session.js';

it('captures the current public roster and does not upload an old world after resync', async () => {
  const sim = new Simulation({ seed: 7, content: testContent() });
  const session: GameSession = {
    world: { kind: 'map', mapId: 'test' },
    seed: 7,
    localSeat: 0,
    speed: 1,
    rules: { fog: null, progression: null, needs: null },
    seats: [
      { player: 0, mode: 'human', color: 3, team: 1 },
      { player: 1, mode: 'human', color: 4 },
    ],
  };
  const client = new RelayClient({
    token: 'secret-reconnect-token',
    nick: 'Ania',
    world: { open: async () => ({ sim, generation: DESCRIPTOR_WORLD }), restore: async () => null },
  });
  client.attach(() => undefined);
  client.receive({ kind: 'start', session, snapshotTick: null });
  await client.settled();
  client.room = {
    id: 'room',
    state: 'running',
    creator: 'Ania',
    settings: { name: 'Game', world: session.world, seed: 7, speed: 1, rules: session.rules },
    seats: [
      {
        player: 0,
        mode: 'human',
        offers: ['idle', 'ai', 'absent'],
        color: 3,
        team: 1,
        nick: 'Ania',
        ready: false,
      },
      { player: 1, mode: 'ai', offers: ['idle', 'ai', 'absent'], color: 4, nick: null, ready: false },
    ],
    members: [{ nick: 'Ania', seat: 0, connected: true, compatibility: null }],
  };
  const hooks = networkSaveSession(client, sim);
  const metadata = parseSavedSessionMetadata(hooks.sessionMetadata?.());
  expect(metadata?.descriptor.seats[1]?.mode).toBe('ai');
  expect(metadata?.roster).toEqual([
    { player: 0, nick: 'Ania' },
    { player: 1, nick: null },
  ]);
  expect(JSON.stringify(metadata)).not.toContain(client.token);
  const save = exportSaveGame(sim, { mapId: 'test', session: metadata });
  const upload = vi.spyOn(client, 'shareSave').mockResolvedValue();
  await hooks.onSaved?.(save);
  expect(upload).toHaveBeenCalledWith(null, save);
  client.receive({ kind: 'left' });
  await hooks.onSaved?.(save);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(() => hooks.sessionMetadata?.()).toThrow(/no longer active/);
});
