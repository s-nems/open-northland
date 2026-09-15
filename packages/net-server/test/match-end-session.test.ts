import type { GameSession } from '@open-northland/lockstep';
import { prepareInitialSave } from '@open-northland/net-client';
import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import {
  adminCommand,
  components,
  exportSaveGame,
  fx,
  restoreSimulation,
  type SaveGame,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, relink, runFor, type Stage, settle } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

const SETTINGS: RoomSettings = {
  name: 'result',
  world: { kind: 'scene', sceneId: 'result' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const SEATS = [
  { player: 0, mode: 'idle', color: 0 },
  { player: 1, mode: 'idle', color: 1 },
  { player: 2, mode: 'idle', color: 2 },
] as const;
const LINK = { latencyMs: 80, jitterMs: 50 };
const SETTLE = 500;
function stage(): Stage {
  const clock = new VirtualClock(),
    relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(33)) };
}
function buildWorld(localDefeat = false): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent() });
  sim.enqueueSetup({ kind: 'setMatchParticipants', players: localDefeat ? [0, 1, 2] : [0, 1] });
  const players = localDefeat ? [1, 2] : [0, 1];
  let target = null;
  for (const player of players) {
    const entity = sim.world.create();
    components.addPerson(sim.world, entity, {
      tribe: 1,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(entity, components.Owner, { player });
    sim.world.add(entity, components.Health, { hitpoints: 100, max: 100 });
    target = entity;
  }
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.run(749);
  if (!localDefeat && target !== null) sim.enqueue(adminCommand({ kind: 'debugKill', target }));
  return sim;
}
function client(nick: string, localDefeat = false) {
  return new HeadlessClient({
    token: `${nick}-0123456789abcdef`,
    nick,
    buildWorld: async () => buildWorld(localDefeat),
    restoreWorld: async (_session: GameSession, save: SaveGame) =>
      restoreSimulation(save, { content: testContent() }),
  });
}
async function assembled(localDefeat = false) {
  const s = stage(),
    a = client('Ania', localDefeat),
    b = client('Bartek', localDefeat);
  const links = [s.network.link(a, LINK), s.network.link(b, LINK)];
  await assembleRoom(s, [a, b], { settings: SETTINGS, seats: SEATS, seatOf: (i) => i, settleMs: SETTLE });
  return { s, a, b, links };
}
describe('terminal real relayed worlds', () => {
  it('freezes both jittered clients at the same result tick despite frames already in flight', async () => {
    const { s, a, b } = await assembled();
    await runFor(s, [a, b], 3000);
    expect(a.tick).toBe(750);
    expect(b.tick).toBe(750);
    expect(a.sim?.hashState()).toBe(b.sim?.hashState());
    expect(a.sim?.matchEnded()).toBe(true);
    expect(a.room?.state).toBe('ended');
    expect(b.room?.state).toBe('ended');
    expect(a.endedTick).toBe(750);
    expect(b.endedTick).toBe(750);
    expect(a.rejections).toEqual([]);
    expect(b.rejections).toEqual([]);
  });
  it('does not finish when only the local player is defeated', async () => {
    const { s, a, b } = await assembled(true);
    await runFor(s, [a, b], 2000);
    expect(a.sim?.matchOutcome(0)).toBe('defeat');
    expect(a.sim?.matchEnded()).toBe(false);
    expect(a.tick).toBeGreaterThan(750);
    expect(a.room?.state).toBe('running');
    expect(a.endedTick).toBeNull();
  });
  it('reconnects a member dropped just before the result from a terminal snapshot', async () => {
    const { s, a, b, links } = await assembled();
    for (let ms = 0; ms < 3000 && (a.tick ?? 0) < 750; ms += 5) {
      settle(s, 5);
      a.advance(5, () => {
        if (a.tick === 750) links[1]?.close();
      });
      if ((a.tick ?? 0) < 750) b.advance(5);
      await Promise.all([a.settled(), b.settled()]);
    }
    await runFor(s, [a], 2000);
    expect(a.room?.state).toBe('ended');
    a.receive({ kind: 'snapshotRequest' });
    await a.settled();
    settle(s, SETTLE);
    const back = client('Bartek');
    relink(s, back, LINK);
    await runFor(s, [a, back], 2000);
    expect(back.tick).toBe(750);
    expect(back.endedTick).toBe(750);
    expect(back.room?.state).toBe('ended');
    expect(back.sim?.hashState()).toBe(a.sim?.hashState());
    expect(back.rejections).toEqual([]);
  });
  it('accepts a save already at its terminal tick without needing an incremental digest', async () => {
    const sim = buildWorld();
    sim.step();
    const prepared = await prepareInitialSave(exportSaveGame(sim));
    const s = stage(),
      a = client('Ania'),
      b = client('Bartek');
    for (const c of [a, b]) relink(s, c, LINK);
    settle(s, SETTLE);
    a.createRoom({ ...SETTINGS, initialSave: prepared.identity }, SEATS);
    settle(s, SETTLE);
    const id = a.room?.id;
    if (!id) throw new Error('no room');
    b.joinRoom(id);
    settle(s, SETTLE);
    a.claimSeat(0);
    b.claimSeat(1);
    settle(s, SETTLE);
    a.sendBlob({ type: 'initialSave', to: null, tick: 750, bytes: prepared.bytes });
    for (const c of [a, b])
      c.setCompatibility({ ...TEST_COMPATIBILITY, save: prepared.identity.fingerprint });
    settle(s, SETTLE);
    for (const c of [a, b]) c.setReady(true);
    settle(s, SETTLE);
    a.start();
    await runFor(s, [a, b], 3000);
    expect(a.room?.state).toBe('ended');
    expect(b.room?.state).toBe('ended');
    expect(a.tick).toBe(750);
    expect(b.tick).toBe(750);
    expect(a.rejections).toEqual([]);
    expect(b.rejections).toEqual([]);
  });
});
