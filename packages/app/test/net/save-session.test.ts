import { type GameSession, parseSavedSessionMetadata } from '@open-northland/lockstep';
import { RelayClient } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, type RoomView } from '@open-northland/net-protocol';
import { Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../../sim/test/fixtures/content.js';
import { networkSaveSession } from '../../src/net/save-session.js';

it('captures the current public roster and refuses an old world after resync', async () => {
  const sim = new Simulation({ seed: 7, content: testContent() });
  const session: GameSession = {
    world: { kind: 'map', mapId: 'test' },
    seed: 7,
    localSeat: 0,
    speed: 1,
    rules: {
      fog: null,
      progression: null,
      needs: null,
      weather: null,
      dayNight: null,
      alliedVision: null,
      peace: null,
    },
    seats: [
      { player: 0, mode: 'human', color: 3 },
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
  const room: RoomView = {
    id: 'room',
    state: 'running',
    creator: 'Ania',
    settings: { name: 'Game', world: session.world, seed: 7, speed: 1, rules: session.rules },
    seats: [
      {
        player: 0,
        mode: 'human',
        claimable: true,
        offers: ['idle', 'computer', 'absent'],
        color: 3,
        nick: 'Ania',
        ready: false,
        difficulty: 'hard',
      },
      {
        player: 1,
        mode: 'computer',
        claimable: true,
        offers: ['idle', 'computer', 'absent'],
        color: 4,
        nick: null,
        ready: false,
        difficulty: 'easy',
      },
      {
        player: 2,
        mode: 'idle',
        claimable: true,
        offers: ['idle', 'computer', 'absent'],
        color: 5,
        nick: null,
        ready: false,
        difficulty: 'medium',
      },
      {
        player: 3,
        mode: 'absent',
        claimable: true,
        offers: ['idle', 'computer', 'absent'],
        color: 6,
        nick: null,
        ready: false,
        difficulty: 'hard',
      },
    ],
    members: [
      {
        nick: 'Ania',
        seat: 0,
        connected: true,
        compatibility: null,
        load: null,
        loading: null,
        roundTripMs: null,
        delayTicks: null,
        behindTicks: 0,
      },
    ],
  };
  client.receive({ kind: 'room', room });
  const worldId = client.worldId;
  if (worldId === null) throw new Error('the client adopted no world');
  const hooks = networkSaveSession(client, worldId);
  const metadata = parseSavedSessionMetadata(hooks.sessionMetadata?.());
  expect(metadata?.descriptor.seats[1]?.mode).toBe('computer');
  expect(metadata?.descriptor.seats.map(({ difficulty }) => difficulty)).toEqual([
    undefined,
    'easy',
    undefined,
    undefined,
  ]);
  expect(metadata?.roster).toEqual([
    { player: 0, nick: 'Ania' },
    { player: 1, nick: null },
    { player: 2, nick: null },
    { player: 3, nick: null },
  ]);
  expect(JSON.stringify(metadata)).not.toContain(client.token);
  client.receive({ kind: 'left' });
  expect(() => hooks.sessionMetadata?.()).toThrow(/no longer active/);
});
