import { prepareInitialSave } from '@open-northland/net-client';
import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, restoreSimulation, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, relink, runFor, runUntil, type Stage, settle } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

const settings: RoomSettings = {
  name: 'saved orders',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
function client(nick: string) {
  return new HeadlessClient({
    token: `${nick}-0123456789abcdef`,
    nick,
    buildWorld: async () => new Simulation({ seed: 7, content: testContent() }),
    restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent() }),
  });
}
describe('manual save accepted orders end to end', () => {
  it('resumes both paused players accepted commands exactly once at their assigned tick and order', async () => {
    const clock = new VirtualClock(),
      relay = new Relay({ now: clock.now });
    const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(73)) };
    const a = client('Ania'),
      b = client('Bartek');
    for (const c of [a, b]) stage.network.link(c, { latencyMs: 70, jitterMs: 30 });
    await assembleRoom(stage, [a, b], {
      settings,
      seats: [
        { player: 0, mode: 'idle', color: 0 },
        { player: 1, mode: 'idle', color: 1 },
      ],
      seatOf: (i) => i,
      settleMs: 500,
    });
    await runFor(stage, [a, b], 1000);
    a.setPaused(true);
    await runFor(stage, [a, b], 500);
    expect(a.tick).toBe(b.tick);
    expect(a.paused).toBe(true);
    for (const [c, player, value] of [
      [a, 0, 11],
      [b, 1, 22],
    ] as const)
      c.submit(
        playerCommand(player, {
          kind: 'setAssistantCounter',
          player,
          counter: 'extraMen',
          value,
          infinite: false,
        }),
      );
    await runFor(stage, [a, b], 500);
    const pending = a.captureSave();
    await runFor(stage, [a, b], 500);
    const save = await pending;
    const section = save.sections.find((s) => s.id === 'commands');
    expect(section?.continuation).toHaveLength(2);
    expect(section?.continuation.map((c) => c.envelope.command)).toMatchObject(
      expect.arrayContaining([
        { kind: 'setAssistantCounter', player: 0, counter: 'extraMen', value: 11, infinite: false },
        { kind: 'setAssistantCounter', player: 1, counter: 'extraMen', value: 22, infinite: false },
      ]),
    );
    const target = save.header.tick + 10;
    const restored = [
      restoreSimulation(save, { content: testContent() }),
      restoreSimulation(save, { content: testContent() }),
    ];
    for (const sim of restored) sim.run(target - sim.tick);
    a.setPaused(false);
    const captures = await runUntil(stage, [a, b], target);
    expect(captures.get(a)?.hash).toBe(captures.get(b)?.hash);
    for (const sim of restored) {
      expect(sim.hashState()).toBe(captures.get(a)?.hash);
      expect(
        sim.commands.log.map(({ applyTick, sequence, command }) => [applyTick, sequence, command]),
      ).toEqual(captures.get(a)?.log);
    }
    expect(a.rejections).toEqual([]);
    expect(b.rejections).toEqual([]);

    const prepared = await prepareInitialSave(save);
    const nextClock = new VirtualClock();
    const nextRelay = new Relay({ now: nextClock.now });
    const next: Stage = {
      clock: nextClock,
      relay: nextRelay,
      network: new VirtualNetwork(nextClock, nextRelay, seededRandom(14)),
    };
    const host = client('Host'),
      guest = client('Guest');
    for (const c of [host, guest]) relink(next, c, { latencyMs: 40, jitterMs: 10 });
    settle(next, 300);
    host.createRoom({ ...settings, initialSave: prepared.identity }, [
      { player: 0, mode: 'idle', color: 0 },
      { player: 1, mode: 'idle', color: 1 },
    ]);
    settle(next, 300);
    const id = host.room?.id;
    if (id === undefined) throw new Error('new room missing');
    guest.joinRoom(id);
    settle(next, 300);
    host.claimSeat(0);
    guest.claimSeat(1);
    settle(next, 300);
    host.sendBlob({ type: 'initialSave', to: null, tick: save.header.tick, bytes: prepared.bytes });
    for (const c of [host, guest])
      c.setCompatibility({ ...TEST_COMPATIBILITY, save: prepared.identity.fingerprint });
    settle(next, 300);
    for (const c of [host, guest]) c.setReady(true);
    settle(next, 300);
    host.start();
    const resumed = await runUntil(next, [host, guest], target);
    expect(resumed.get(host)?.hash).toBe(captures.get(a)?.hash);
    expect(resumed.get(guest)?.hash).toBe(captures.get(a)?.hash);
    for (const c of [host, guest]) {
      const orders = resumed.get(c)?.log.filter((entry) => entry[2].kind === 'setAssistantCounter');
      expect(orders?.map(([tick, , command]) => [tick, command])).toEqual(
        section?.continuation.map(({ applyTick, envelope }) => [applyTick, envelope.command]),
      );
      expect(c.rejections).toEqual([]);
      expect(c.desyncs).toEqual([]);
    }
  });
});
