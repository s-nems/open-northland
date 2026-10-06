import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapLobbySlots } from '@open-northland/data';
import { aiSeatsOf, type GameSession, humanSeatsOf } from '@open-northland/lockstep';
import type { RoomSeatSetup, RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, type SaveGame, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import { assembleRoom, runUntil, type Stage } from '../../../net-server/test/support/session-run.js';
import {
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../../../net-server/test/support/virtual-network.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { authoredVacantMode, vacantOffers } from '../../src/entries/main-menu/lobby/roster-state.js';
import { buildRelayedMapWorld, type MapWorkerBoot } from '../../src/entries/map/world-inputs.js';
import { assemblePacedRoom, PacedStage } from '../support/net-worker/paced-stage.js';
import { WorkerHeadlessClient } from '../support/net-worker/worker-headless-client.js';
import { bundleTestWorker } from '../support/session-worker/start-worker.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapScript, realMapWorld, restoreRealMapWorld } from './real-map-world.js';

/**
 * The relay proven on the map a session is played on: every client assembles the world from the
 * descriptor the relay broadcast, plays through frames the relay assigned over links with injected
 * latency and jitter, and must end on one state and one command log. A client pushed off its state
 * must come back from the other's snapshot, restored onto the same map, and end there too.
 *
 * `ON_RELAY_TICKS` lengthens each run; the default keeps the file within a content-suite budget.
 */

const MAP_ID = 'magiczny_las';
const EIGHT_PLAYER_MAP_ID = 'magiczny_las_12_players';
const DEFAULT_RUN_TICKS = 600;
const RUN_TICKS = Number.parseInt(process.env.ON_RELAY_TICKS ?? '', 10) || DEFAULT_RUN_TICKS;
/** Orders per client, staggered by seat so some share a tick with another seat's or the AI's. */
const ORDER_EVERY_TICKS = 20;
const LINKS = [
  { latencyMs: 40, jitterMs: 10 },
  { latencyMs: 120, jitterMs: 40 },
  { latencyMs: 250, jitterMs: 80 },
];
const RULES = { fog: null, progression: null, needs: null, weather: null };
/** Virtual time for a lobby step to cross the slowest link twice, with margin. */
const LOBBY_SETTLE_MS = 800;
const RUN_TIMEOUT_MS = 900_000;
/** The tick one client's RNG is pushed off its stream on, once the economy has something to diverge. */
const DIVERGE_AT_TICK = 200;
const NET_WORKER_ENTRY = fileURLToPath(new URL('../support/net-worker/node-net-worker.ts', import.meta.url));
/** A worker-hosted client plays in real time, so its room runs faster and shorter than the inline
 *  runs; within the digest trail a client keeps, so every acknowledged tick is compared. */
const WORKER_ROOM_SPEED = 4;
const WORKER_RUN_TICKS = 240;
const WORKER_STEP_TIMEOUT_MS = 20_000;
const WORKER_OPEN_TIMEOUT_MS = 120_000;
const WORKER_RUN_TIMEOUT_MS = 120_000;
/** Real time for the frames in flight on the slowest link to land once the relay holds. */
const LINK_DRAIN_MS = 500;

async function buildWorld(session: GameSession): Promise<Simulation> {
  if (session.world.kind !== 'map') throw new Error(`a map session, not ${session.world.kind}`);
  const world = await realMapWorld({
    mapId: session.world.mapId,
    aiSeats: aiSeatsOf(session),
    humanSeats: humanSeatsOf(session),
    seed: session.seed,
    rules: session.rules,
    seats: session.seats,
    berryBushes: true,
  });
  return world.sim;
}

async function restoreWorld(session: GameSession, save: SaveGame): Promise<Simulation> {
  if (session.world.kind !== 'map') throw new Error(`a map session, not ${session.world.kind}`);
  return restoreRealMapWorld(session.world.mapId, save);
}

/** The room's seats as the lobby would take them from the map script: AI seats stay AI, the rest wait. */
function seatsFromScript(mapId: string): readonly RoomSeatSetup[] {
  const script = realMapScript(mapId);
  if (script === null) throw new Error(`${mapId} ships no script`);
  return mapLobbySlots(script).map((slot) => ({
    player: slot.player,
    mode: authoredVacantMode(slot),
    offers: vacantOffers(slot),
    color: slot.colorId,
  }));
}

function stageFor(seed: number): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
}

function orderAt(client: Pick<HeadlessClient, 'session' | 'submit'>, tick: number): void {
  const seat = client.session?.localSeat;
  if (typeof seat !== 'number' || tick % ORDER_EVERY_TICKS !== seat % ORDER_EVERY_TICKS) return;
  client.submit(
    playerCommand(seat, {
      kind: 'setAssistantCounter',
      player: seat,
      counter: 'extraMen',
      value: tick % ORDER_EVERY_TICKS,
      infinite: false,
    }),
  );
}

/** The inputs the relayed entry hands its network worker for a session on `mapId`: the documents the
 *  runtime loaded and the session. */
async function relayedMapBoot(mapId: string): Promise<(session: GameSession) => MapWorkerBoot> {
  const { merge } = await loadContentUnderTest();
  const map = JSON.parse(readFileSync(realMapPath(mapId), 'utf8'));
  const ir = rawIrUnderTest() as ContentIr;
  const script = realMapScript(mapId);
  return (session) => ({
    map,
    ir,
    script,
    goodNames: new Map(),
    content: merge.content,
    session,
    missions: null,
    saveText: null,
  });
}

function ticksFrom(first: number, last: number): number[] {
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

interface PlayOptions {
  /** The client, by index, whose state is pushed off at `DIVERGE_AT_TICK`. */
  readonly diverge?: number;
}

async function playThrough(
  mapId: string,
  count: number,
  options: PlayOptions = {},
): Promise<HeadlessClient[]> {
  const stage = stageFor(count);
  const seats = seatsFromScript(mapId);
  const openSeats = seats.filter((seat) => seat.mode === 'idle').map((seat) => seat.player);
  expect(openSeats.length).toBeGreaterThanOrEqual(count);
  const clients = Array.from({ length: count }, (_, i) => {
    const client = new HeadlessClient({
      token: `client-${i}-token-0123456789`,
      nick: `Gracz ${i}`,
      buildWorld,
      restoreWorld,
    });
    stage.network.link(client, {
      ...LINKS[i % LINKS.length],
      uploadBytesPerSecond: 128 * 1024,
      downloadBytesPerSecond: 512 * 1024,
    });
    return client;
  });
  const settings: RoomSettings = {
    name: mapId,
    world: { kind: 'map', mapId },
    seed: 7,
    rules: RULES,
    speed: 1,
  };
  await assembleRoom(stage, clients, {
    settings,
    seats,
    seatOf: (i) => openSeats[i] ?? -1,
    settleMs: LOBBY_SETTLE_MS,
  });
  const diverging = options.diverge === undefined ? null : clients[options.diverge];
  const captures = await runUntil(stage, clients, RUN_TICKS, {
    onTick: (client, tick) => {
      orderAt(client, tick);
      if (client === diverging && tick === DIVERGE_AT_TICK && client.sim !== null) {
        client.sim.rng.setState(client.sim.rng.getState() ^ 1);
      }
    },
  });

  const [first, ...rest] = clients;
  if (first === undefined) throw new Error('no clients');
  const reference = captures.get(first);
  // A restored sim's log starts at its snapshot, so the logs are compared from there on.
  const since = Math.max(0, ...clients.flatMap((client) => client.restoredFrom));
  const logSince = (client: HeadlessClient) =>
    captures.get(client)?.log.filter(([applyTick]) => applyTick > since);
  for (const client of rest) {
    expect(captures.get(client)?.hash, `${client.nick} against ${first.nick}`).toBe(reference?.hash);
    expect(logSince(client)).toEqual(logSince(first));
  }
  for (const client of clients) {
    expect(client.rejections, client.nick).toEqual([]);
    expect(client.dropped, client.nick).toEqual([]);
  }
  // Every seat's orders crossed the wire, and the log is not the AI's alone.
  const seatsHeard = new Set(
    reference?.log.flatMap(([, , command]) => ('player' in command ? [command.player] : [])),
  );
  for (const client of clients) {
    const seat = client.session?.localSeat;
    expect(typeof seat === 'number' && seatsHeard.has(seat), client.nick).toBe(true);
  }
  for (const client of clients) {
    expect(client.sim?.missionStatus().some((mission) => (mission.fireCount ?? 0) > 0)).toBe(true);
  }
  return clients;
}

/** `ON_RELAY_PARITY=off` skips the file: these runs are most of the content suite's time. */
const RUN_PARITY = process.env.ON_RELAY_PARITY !== 'off' && hasRealIr() && existsSync(realMapPath(MAP_ID));

describe.runIf(RUN_PARITY)('relayed sessions on a decoded map', () => {
  it.skipIf(!existsSync(realMapPath(EIGHT_PLAYER_MAP_ID)))(
    'eight clients recover from a divergence on the twelve-seat map',
    {
      timeout: RUN_TIMEOUT_MS,
    },
    async () => {
      const clients = await playThrough(EIGHT_PLAYER_MAP_ID, 8, { diverge: 7 });
      expect(clients[7]?.desyncs).toHaveLength(1);
      expect(clients[7]?.restoredFrom).toHaveLength(1);
      for (const each of clients.slice(0, 7)) expect(each.desyncs).toEqual([]);
    },
  );

  it('four clients end on one state', { timeout: RUN_TIMEOUT_MS }, async () => {
    await playThrough(MAP_ID, 4);
  });

  it('brings a diverged client back from the other’s snapshot on the real map', {
    timeout: RUN_TIMEOUT_MS,
  }, async () => {
    expect(RUN_TICKS).toBeGreaterThan(DIVERGE_AT_TICK);
    const [reference, diverged] = await playThrough(MAP_ID, 2, { diverge: 1 });
    expect(diverged?.desyncs).toHaveLength(1);
    expect(diverged?.desyncs[0]).toMatchObject({ tick: DIVERGE_AT_TICK + 1, reference: reference?.nick });
    expect(diverged?.restoredFrom).toHaveLength(1);
    // Longer runs also refresh the recovery snapshot on its regular cadence.
    expect(reference?.snapshotsSent).toBeGreaterThanOrEqual(1);
    expect(reference?.desyncs).toEqual([]);
  });

  it('a worker-hosted client acknowledges the inline client’s digests and ends on its state', {
    timeout: RUN_TIMEOUT_MS,
  }, async () => {
    const bundle = await bundleTestWorker(NET_WORKER_ENTRY);
    const boot = await relayedMapBoot(MAP_ID);
    // Both clients build through the relayed entry's builder: the worker from the inputs it was
    // posted, the inline client from the same inputs on this thread.
    const peer = new HeadlessClient({
      token: 'client-0-token-0123456789',
      nick: 'Gracz 0',
      buildWorld: async (session) => buildRelayedMapWorld(boot(session), null).sim,
      restoreWorld: async (session, save) => buildRelayedMapWorld(boot(session), save).sim,
    });
    const hosted = new WorkerHeadlessClient({
      workerPath: bundle.path,
      token: 'client-1-token-0123456789',
      nick: 'Gracz 1',
      boot,
    });
    try {
      const stage = stageFor(LINKS.length);
      const seats = seatsFromScript(MAP_ID);
      const openSeats = seats.filter((seat) => seat.mode === 'idle').map((seat) => seat.player);
      stage.network.link(peer, LINKS[0]);
      stage.network.link(hosted, LINKS[1]);
      const paced = new PacedStage(stage, [peer], [hosted], (member, tick) => orderAt(member, tick));
      await assemblePacedRoom(paced, [peer, hosted], {
        settings: {
          name: MAP_ID,
          world: { kind: 'map', mapId: MAP_ID },
          seed: 7,
          rules: RULES,
          speed: WORKER_ROOM_SPEED,
        },
        seats,
        seatOf: (i) => openSeats[i] ?? -1,
        stepTimeoutMs: WORKER_STEP_TIMEOUT_MS,
      });
      await paced.until(
        'both clients hold the world',
        () => peer.sim !== null && hosted.world !== null,
        WORKER_OPEN_TIMEOUT_MS,
      );
      await paced.until(
        `both clients pass tick ${WORKER_RUN_TICKS}`,
        () => (peer.tick ?? 0) >= WORKER_RUN_TICKS && hosted.ackedTick >= WORKER_RUN_TICKS,
        WORKER_RUN_TIMEOUT_MS,
      );
      paced.relayHeld = true;
      await paced.runFor(LINK_DRAIN_MS);
      await paced.until(
        'both clients rest on the relay’s last frame',
        () =>
          hosted.ackedTick === hosted.lastFrameTick &&
          hosted.tick === hosted.lastFrameTick &&
          peer.tick === hosted.lastFrameTick,
        WORKER_STEP_TIMEOUT_MS,
      );

      const lastTick = hosted.lastFrameTick;
      const { world } = hosted;
      const sim = peer.sim;
      if (world === null || sim === null) throw new Error('a client lost its world');
      expect(await world.session.host.hashState()).toEqual({ tick: lastTick, hash: sim.hashState() });
      // Every tick the worker stepped was acknowledged with the inline client's digest.
      const digests = await hosted.connection.digests();
      expect(digests.map((entry) => entry.tick)).toEqual(ticksFrom((hosted.openedAtTick ?? 0) + 1, lastTick));
      expect(digests).toEqual(peer.digests.list());
      expect(hosted.acks.map(({ tick, digest }) => ({ tick, digest }))).toEqual(digests);
      const log = await world.session.host.commandLog();
      expect(log).toEqual(sim.commands.log);
      const seatsHeard = new Set(log.flatMap((command) => ('player' in command ? [command.player] : [])));
      for (const client of [peer, hosted]) {
        const seat = client.session?.localSeat;
        expect(typeof seat === 'number' && seatsHeard.has(seat), client.nick).toBe(true);
      }
      expect(peer.rejections).toEqual([]);
      expect(peer.dropped).toEqual([]);
      expect(peer.desyncs).toEqual([]);
      expect(hosted.rejections).toEqual([]);
      expect(hosted.failures).toEqual([]);
      expect(hosted.desyncs).toEqual([]);
    } finally {
      hosted.dispose();
      await bundle.dispose();
    }
  });
});
