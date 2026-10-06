import { RelayClient } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, MAX_SPEED } from '@open-northland/net-protocol';
import { Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { SocketBudget } from '../src/host/socket-budget.js';

it('catches up at maximum speed within the host traffic budget while still sending every digest', async () => {
  const sim = new Simulation({ seed: 1, content: testContent() });
  let now = 0;
  const budget = new SocketBudget(now);
  const refused: string[] = [];
  const ticks: number[] = [];
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    now: () => now,
    world: {
      open: async () => ({ sim, generation: DESCRIPTOR_WORLD }),
      restore: async () => null,
    },
  });
  client.attach((message) => {
    if (!budget.take(Buffer.byteLength(JSON.stringify(message)), now)) refused.push(message.kind);
    if (message.kind === 'ack') ticks.push(message.tick);
  });
  client.receive({
    kind: 'start',
    snapshotTick: null,
    session: {
      world: { kind: 'scene', sceneId: 'fixture' },
      seed: 1,
      seats: [{ player: 0, color: 0, mode: 'human' }],
      localSeat: 0,
      rules: { fog: null, progression: null, needs: null, weather: null },
      speed: MAX_SPEED,
    },
  });
  await client.settled();
  const backlog = 5000;
  for (let tick = 1; tick <= backlog; tick++) client.receive({ kind: 'frame', tick, commands: [] });
  // A fast display and cheap world expose the drain rate; regular pings still need headroom.
  const frameMs = 1000 / 144;
  for (let frame = 1; frame <= 144 * 40 && ticks.length < backlog; frame++) {
    now += frameMs;
    if (frame % 144 === 0) client.receive({ kind: 'ping', t: now, roundTripMs: 0, delayTicks: 2 });
    client.advance(frameMs);
  }
  expect(refused).toEqual([]);
  expect(ticks).toEqual(Array.from({ length: backlog }, (_, index) => index + 1));
});
