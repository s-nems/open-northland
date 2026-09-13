import type { GameSession } from '@open-northland/lockstep';
import { prepareInitialSave } from '@open-northland/net-client';
import { type RoomSettings, TICK_MS } from '@open-northland/net-protocol';
import { KICK_COUNTDOWN_MS, Relay, SILENT_AFTER_MS } from '@open-northland/net-server';
import {
  exportSaveGame,
  playerCommand,
  restoreSimulation,
  type SaveGame,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { HeadlessClient } from './support/headless-client.js';
import {
  assembleRoom,
  type Capture,
  relink,
  runFor,
  runUntil,
  type Stage,
  settle,
} from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

/**
 * Real sims on both ends of the relay while things go wrong: a socket drops or goes quiet, a client's
 * state diverges, a seat is voted out, a player comes back with nothing. Every run must still end
 * with one state on every client that is left.
 */

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 5,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const SEATS = [
  { player: 0, mode: 'idle', color: 0 },
  { player: 1, mode: 'idle', color: 1 },
  { player: 2, mode: 'ai', color: 2 },
] as const;
const RUN_TICKS = 200;
const ORDER_EVERY_TICKS = 7;
const LINK = { latencyMs: 60, jitterMs: 20 };
/** Time for a lobby step, a reconnect, or a snapshot to cross the link and back, with margin. */
const SETTLE_MS = 400;
/** A run that waits out a countdown needs the virtual deadline pushed past it. */
const LONG_RUN_MS = KICK_COUNTDOWN_MS * 3;

async function buildWorld(session: GameSession): Promise<Simulation> {
  return new Simulation({ seed: session.seed, content: testContent() });
}

async function restoreWorld(_session: GameSession, save: SaveGame): Promise<Simulation> {
  return restoreSimulation(save, { content: testContent() }).sim;
}

function client(nick: string): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld,
    restoreWorld,
  });
}

function stageFor(seed: number): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
}

function orderAt(client: HeadlessClient, tick: number): void {
  const seat = client.session?.localSeat;
  if (typeof seat !== 'number' || tick % ORDER_EVERY_TICKS !== seat) return;
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

/** Push one client's RNG off its stream on `atTick`: the smallest divergence, in one domain. */
function divergeAt(target: HeadlessClient, atTick: number) {
  return (client: HeadlessClient, tick: number): void => {
    orderAt(client, tick);
    if (client === target && tick === atTick && client.sim !== null) {
      client.sim.rng.setState(client.sim.rng.getState() ^ 1);
    }
  };
}

async function twoClients(seed: number) {
  const stage = stageFor(seed);
  const ania = client('Ania');
  const bartek = client('Bartek');
  const links = [stage.network.link(ania, LINK), stage.network.link(bartek, LINK)] as const;
  await assembleRoom(stage, [ania, bartek], {
    settings: SETTINGS,
    seats: SEATS,
    seatOf: (i) => i,
    settleMs: SETTLE_MS,
  });
  return { stage, ania, bartek, links };
}

/** One hash everywhere, and one command log from the last tick anyone rebuilt at: a restored sim's
 *  log starts at its snapshot. */
function expectAgreement(captures: Map<HeadlessClient, Capture>, clients: readonly HeadlessClient[]): void {
  const [first, ...rest] = clients;
  if (first === undefined) throw new Error('no clients');
  const since = Math.max(0, ...clients.flatMap((each) => each.restoredFrom));
  const logSince = (each: HeadlessClient) =>
    captures.get(each)?.log.filter(([applyTick]) => applyTick > since);
  expect(logSince(first)?.length).toBeGreaterThan(0);
  for (const other of rest) {
    expect(captures.get(other)?.hash, `${other.nick} against ${first.nick}`).toBe(captures.get(first)?.hash);
    expect(logSince(other)).toEqual(logSince(first));
  }
  for (const each of clients) expect(each.dropped, each.nick).toEqual([]);
}

describe('a relayed session under faults', () => {
  it('holds for a dropped client and resumes on its return without a resync', async () => {
    const { stage, ania, bartek, links } = await twoClients(1);
    await runUntil(stage, [ania, bartek], 40, { onTick: orderAt });
    links[1].close();
    await runFor(stage, [ania, bartek], SETTLE_MS);
    expect(ania.waits.at(-1)?.for).toMatchObject([{ nick: 'Bartek', reason: 'gone' }]);
    const held = ania.tick;
    await runFor(stage, [ania, bartek], TICK_MS * 48);
    expect(ania.tick).toBe(held);

    relink(stage, bartek, LINK);
    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: orderAt });
    expectAgreement(captures, [ania, bartek]);
    expect(ania.waits.at(-1)?.for).toEqual([]);
    expect(bartek.restoredFrom).toEqual([]);
    expect(bartek.rejections).toEqual([]);
  });

  it('lets a client behind a silent socket catch up from the frames alone', async () => {
    const { stage, ania, bartek, links } = await twoClients(2);
    await runUntil(stage, [ania, bartek], 40, { onTick: orderAt });
    const cutAt = bartek.tick ?? 0;
    links[1].cut();
    await runFor(stage, [ania, bartek], SILENT_AFTER_MS + SETTLE_MS);
    expect(ania.tick).toBeGreaterThan(cutAt);
    expect(ania.waits.at(-1)?.for.map((entry) => entry.nick)).toEqual(['Bartek']);

    relink(stage, bartek, LINK);
    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: orderAt });
    expectAgreement(captures, [ania, bartek]);
    expect(bartek.restoredFrom).toEqual([]);
    expect(bartek.rejections).toEqual([]);
  });

  it('detects a diverged client within a tick, names the domain, and resyncs it from the reference', async () => {
    const { stage, ania, bartek } = await twoClients(3);
    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: divergeAt(bartek, 50) });
    expect(bartek.desyncs).toHaveLength(1);
    expect(bartek.desyncs[0]).toMatchObject({ tick: 51, reference: 'Ania' });
    expect(bartek.desyncs[0]?.domains).toContain('rng');
    expect(ania.desyncs).toEqual([]);
    expect(ania.snapshotsSent).toBe(1);
    expect(bartek.restoredFrom).toHaveLength(1);
    expect(bartek.restoredFrom[0]).toBeGreaterThanOrEqual(51);
    expect(ania.waits.some((wait) => wait.for.some((entry) => entry.reason === 'resync'))).toBe(true);
    expectAgreement(captures, [ania, bartek]);
  });

  it('resolves a two-client tie to the longer-connected one, even when it is the one that diverged', async () => {
    const { stage, ania, bartek } = await twoClients(4);
    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: divergeAt(ania, 50) });
    expect(ania.desyncs).toEqual([]);
    expect(bartek.desyncs[0]).toMatchObject({ tick: 51, reference: 'Ania' });
    expect(bartek.restoredFrom).toHaveLength(1);
    expectAgreement(captures, [ania, bartek]);
  });

  it('kicks a gone seat after the countdown and hands it to the AI on one tick everywhere', async () => {
    const stage = stageFor(5);
    const ania = client('Ania');
    const bartek = client('Bartek');
    const cezary = client('Cezary');
    stage.network.link(ania, LINK);
    stage.network.link(bartek, LINK);
    const cezaryLink = stage.network.link(cezary, LINK);
    const clients = [ania, bartek, cezary];
    await assembleRoom(stage, clients, {
      settings: SETTINGS,
      seats: SEATS,
      seatOf: (i) => i,
      settleMs: SETTLE_MS,
    });
    await runUntil(stage, clients, 30, { onTick: orderAt });
    cezaryLink.close();
    await runFor(stage, [ania, bartek], SETTLE_MS);
    ania.kick(2);
    await runFor(stage, [ania, bartek], SETTLE_MS);
    expect(ania.rejections.at(-1)?.reason).toMatch(/opens in/);
    await runFor(stage, [ania, bartek], KICK_COUNTDOWN_MS);
    expect(ania.waits.at(-1)).toEqual({
      kind: 'waiting',
      for: [{ nick: 'Cezary', reason: 'gone', voteAfterMs: 0 }],
    });
    ania.kick(2);
    await runFor(stage, [ania, bartek], SETTLE_MS);
    expect(bartek.votes.at(-1)).toMatchObject({ player: 2, nick: 'Cezary', yes: ['Ania'], needed: 1 });
    const kicked = bartek.kicks[0];
    expect(kicked).toMatchObject({ player: 2, nick: 'Cezary', mode: 'ai' });
    expect(bartek.room?.seats[2]).toMatchObject({ mode: 'ai', nick: null });

    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, {
      onTick: orderAt,
      virtualLimitMs: LONG_RUN_MS,
    });
    expectAgreement(captures, [ania, bartek]);
    for (const each of [ania, bartek]) {
      const handover = captures
        .get(each)
        ?.log.filter(([, , command]) => command.kind === 'setPlayerAi')
        .map(([applyTick, , command]) => [applyTick, command]);
      expect(handover, each.nick).toEqual([
        [kicked?.tick, { kind: 'setPlayerAi', player: 2, enabled: true }],
      ]);
    }
  });

  it('brings a player back with nothing from the room’s cached checkpoint', async () => {
    const { stage, ania, bartek, links } = await twoClients(6);
    await runUntil(stage, [ania, bartek], 60, { onTick: orderAt });
    ania.receive({ kind: 'snapshotRequest' });
    await ania.settled();
    settle(stage, SETTLE_MS);
    expect(bartek.blobs).toEqual([]);
    links[1].close();
    const again = client('Bartek');
    relink(stage, again, LINK);
    // The port answers `start` asynchronously, so the ask for the cache and the snapshot it brings
    // need the network stepped between them.
    await runFor(stage, [ania, again], SETTLE_MS);
    expect(again.restoredFrom).toHaveLength(1);
    expect(again.restoredFrom[0]).toBeLessThanOrEqual(60);

    const captures = await runUntil(stage, [ania, again], RUN_TICKS, { onTick: orderAt });
    expectAgreement(captures, [ania, again]);
    expect(again.rejections).toEqual([]);
  });

  it('boots both real clients from the same saved tick and resumes with shared seat control', async () => {
    const stage = stageFor(17),
      ania = client('Ania'),
      bartek = client('Bartek');
    const sim = await buildWorld({ ...SETTINGS, seats: [], localSeat: 0 });
    for (let i = 0; i < 73; i++) sim.step();
    const prepared = await prepareInitialSave(exportSaveGame(sim));
    for (const c of [ania, bartek]) relink(stage, c, LINK);
    settle(stage, SETTLE_MS);
    ania.createRoom({ ...SETTINGS, initialSave: prepared.identity }, SEATS);
    settle(stage, SETTLE_MS);
    const roomId = ania.room?.id;
    if (roomId === undefined) throw new Error('room was not created');
    bartek.joinRoom(roomId);
    settle(stage, SETTLE_MS);
    ania.claimSeat(0);
    bartek.claimSeat(1);
    settle(stage, SETTLE_MS);
    ania.sendBlob({ type: 'initialSave', to: null, tick: 73, bytes: prepared.bytes });
    for (const c of [ania, bartek])
      c.setCompatibility({ ...TEST_COMPATIBILITY, save: prepared.identity.fingerprint });
    settle(stage, SETTLE_MS);
    for (const c of [ania, bartek]) c.setReady(true);
    settle(stage, SETTLE_MS);
    ania.start();
    await runFor(stage, [ania, bartek], SETTLE_MS * 2);
    expect(ania.restoredFrom).toEqual([73]);
    expect(bartek.restoredFrom).toEqual([73]);
    const captures = await runUntil(stage, [ania, bartek], 95);
    expectAgreement(captures, [ania, bartek]);
    expect(ania.rejections).toEqual([]);
    expect(bartek.rejections).toEqual([]);
    expect(captures.get(ania)?.log.filter(([, , command]) => command.kind === 'setPlayerAi')).toHaveLength(
      SEATS.length,
    );
  });

  it('refuses lobby map replacement after a session starts', async () => {
    const { stage, ania, bartek } = await twoClients(7);
    const bytes = Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 251)).toString('base64');
    ania.sendBlob({ type: 'map', to: 'Bartek', tick: null, bytes });
    settle(stage, SETTLE_MS);
    expect(bartek.blobs).toEqual([]);
    expect(ania.rejections.at(-1)).toMatchObject({ reason: 'lobby files are fixed after start' });
    expect(ania.blobs).toEqual([]);
  });
});
