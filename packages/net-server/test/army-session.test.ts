import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, restoreSimulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { expectRouted, map, members, world } from './support/army-world.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, runFor, runUntil, type Stage } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

const settings: RoomSettings = {
  name: 'army control',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null, weather: null },
  speed: 1,
};

describe('army orders over the relay', () => {
  it.each([2, 8])(
    'applies and redirects 1000 soldiers atomically across %i constrained connections',
    async (count) => {
      const clock = new VirtualClock();
      const relay = new Relay({ now: clock.now });
      const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(831)) };
      const clients = Array.from(
        { length: count },
        (_, seat) =>
          new HeadlessClient({
            nick: `Player${seat}`,
            token: `army-player-${seat}-0123456789`,
            buildWorld: async () => world(),
            restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent(), map }),
          }),
      );
      for (const client of clients)
        stage.network.link(client, {
          latencyMs: 120,
          jitterMs: 40,
          uploadBytesPerSecond: 128 * 1024,
          downloadBytesPerSecond: 512 * 1024,
        });
      await assembleRoom(stage, clients, {
        settings,
        seats: clients.map((_, player) => ({ player, mode: 'idle', offers: ['idle', 'ai'], color: player })),
        seatOf: (seat) => seat,
        settleMs: 600,
      });
      const host = clients[0];
      if (host === undefined || host.sim === null) throw new Error('missing army world');
      await runFor(stage, clients, 500);
      host.setPaused(true);
      await runFor(stage, clients, 700);
      const first = members(host.sim, 100);
      const firstOrder = playerCommand(0, { kind: 'attackMoveUnitGroup', members: first });
      // The real wire must admit a complete army, well beyond the former 1 KiB envelope cap.
      expect(Buffer.byteLength(JSON.stringify(firstOrder))).toBeGreaterThan(16 * 1024);
      host.submit(firstOrder);
      await runFor(stage, clients, 700);
      const saving = host.captureSave();
      await runFor(stage, clients, 1000);
      const save = await saving;
      const continuation = save.sections.find((section) => section.id === 'commands')?.continuation;
      expect(continuation).toHaveLength(1);
      expect(continuation?.[0]?.envelope.command).toEqual(firstOrder.command);
      const restored = restoreSimulation(save, { content: testContent(), map });
      const seen = new Map<HeadlessClient, number[]>();
      const checkApplied = (client: HeadlessClient): void => {
        const sim = client.sim;
        if (sim === null) return;
        const orders = sim.commands.log.filter(
          (entry) => entry.origin === 'player' && entry.applyTick === sim.tick,
        );
        for (const entry of orders) {
          if (entry.command.kind !== 'moveUnitGroup' && entry.command.kind !== 'attackMoveUnitGroup')
            continue;
          const ticks = seen.get(client) ?? [];
          ticks.push(entry.applyTick);
          seen.set(client, ticks);
        }
        const last = orders.at(-1)?.command;
        if (last?.kind === 'moveUnitGroup' || last?.kind === 'attackMoveUnitGroup')
          expectRouted(sim, last.members);
      };
      host.setPaused(false);
      const firstTarget = save.header.tick + 12;
      const initial = await runUntil(stage, clients, firstTarget, { onTick: checkApplied });
      restored.run(firstTarget - restored.tick);
      for (const client of clients) {
        expect(initial.get(client)?.hash).toBe(restored.hashState());
        expect(seen.get(client)).toHaveLength(1);
      }
      // Repeated ordinary clicks replace the march; unit count must add no scheduling delay.
      const redirect = members(host.sim, 130);
      host.submit(playerCommand(0, { kind: 'moveUnitGroup', members: members(host.sim, 110) }));
      host.submit(playerCommand(0, { kind: 'attackMoveUnitGroup', members: redirect }));
      const final = await runUntil(stage, clients, firstTarget + 16, { onTick: checkApplied });
      for (const client of clients) {
        expect(final.get(client)).toEqual(final.get(host));
        expect(seen.get(client)).toHaveLength(3);
        expect(client.rejections).toEqual([]);
        expect(client.errors).toEqual([]);
        expect(client.desyncs).toEqual([]);
        if (client.sim === null) throw new Error('lost world');
        expectRouted(client.sim, redirect);
      }
    },
    60_000,
  );
});
