import type { ResponsivenessMode } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, restoreSimulation, Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, runUntil, type Stage } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

it('changes shared pacing repeatedly while eight clients apply every command and tick in agreement', async () => {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(72)) };
  const clients = Array.from(
    { length: 8 },
    (_, seat) =>
      new HeadlessClient({
        token: `pacing-member-${seat}-0123456789`,
        nick: `Player${seat}`,
        buildWorld: async (session) => new Simulation({ seed: session.seed, content: testContent() }),
        restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent() }),
      }),
  );
  for (const [index, client] of clients.entries())
    stage.network.link(client, { latencyMs: 40 + index * 20, jitterMs: 40 });
  await assembleRoom(stage, clients, {
    settings: {
      name: 'pacing',
      world: { kind: 'scene', sceneId: 'fixture' },
      seed: 5,
      rules: { fog: null, progression: null, needs: null, weather: null },
      speed: 1,
    },
    seats: clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle'], color: player })),
    seatOf: (index) => index,
    settleMs: 500,
  });
  const modes: readonly ResponsivenessMode[] = [
    'responsive',
    'smooth',
    'balanced',
    'auto',
    'smooth',
    'responsive',
    'balanced',
    'auto',
  ];
  let commands = 0;
  const captures = await runUntil(stage, clients, 1200, {
    onTick: (client, tick) => {
      const seat = client.session?.localSeat;
      if (typeof seat !== 'number') throw new Error('missing seat');
      // A different player chooses every mode, including changes during input from every seat.
      if (tick === (seat + 1) * 120) {
        const mode = modes[seat];
        if (mode !== undefined) client.setResponsiveness(mode);
      }
      if (tick % 37 === 0 && tick < 1000) {
        commands++;
        client.submit(
          playerCommand(seat, {
            kind: 'setAssistantCounter',
            player: seat,
            counter: 'extraMen',
            value: tick,
            infinite: false,
          }),
        );
      }
    },
  });
  expect(new Set([...captures.values()].map(({ hash }) => hash)).size).toBe(1);
  expect(new Set([...captures.values()].map(({ log }) => JSON.stringify(log))).size).toBe(1);
  for (const [client, capture] of captures) {
    expect(capture.log).toHaveLength(commands);
    expect(client.responsiveness).toEqual(clients[0]?.responsiveness);
    expect(client.responsiveness.mode).toBe('auto');
    expect(client.rejections).toEqual([]);
    expect(client.errors).toEqual([]);
    expect(client.desyncs).toEqual([]);
    expect(client.droppedTicks).toBe(0);
  }
});
