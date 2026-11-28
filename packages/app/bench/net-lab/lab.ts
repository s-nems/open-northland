/**
 * The headless multiplayer load lab: one relayed session on a real decoded map, played by headless
 * human clients over the in-memory network on a virtual clock, with computer seats beside them. Each
 * client runs its own sim, so the wall time a tick costs is measured on every one; the network and the
 * relay run on virtual time, so for one seed everything but the wall-clock measurements repeats.
 */
import { readFileSync } from 'node:fs';
import type { GameSession } from '@open-northland/lockstep';
import { bytesToBase64, decodeSnapshot, prepareInitialSave } from '@open-northland/net-client';
import { type RoomSettings, TICK_MS } from '@open-northland/net-protocol';
import { type SaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { TEST_COMPATIBILITY } from '../../../net-server/test/support/compatibility.js';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import {
  assembleRoom,
  NETWORK_STEP_MS,
  type RoomPlan,
  type Stage,
  settle,
} from '../../../net-server/test/support/session-run.js';
import {
  type Link,
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../../../net-server/test/support/virtual-network.js';
import { buildRelayedMapWorld } from '../../src/entries/map/world-inputs.js';
import { calibrationMs, loadPerCpu } from '../environment.js';
import { ClientProbe } from './client-probe.js';
import type { ChaosEvent, LabConfig } from './config.js';
import { MeteredRelay } from './relay-meter.js';
import { buildReport, type LabReport, type LabWorld, type TimelineSample } from './report.js';
import { labSeats, type RoomSeats, roomRules, savedLabSeats, savedRules, worldBoot } from './world.js';

/** Virtual time for one lobby step to cross the links, before each link's own round trip is added. */
const LOBBY_SETTLE_MS = 800;
/** Virtual time a run may take past its ticks at the room's speed, as a multiple of that time. */
const DEADLINE_FACTOR = 4;
const DEADLINE_SLACK_MS = 60_000;
/** Salts that give each client's order stream and the network's jitter their own sequence. */
const ORDER_SEED_SALT = 0x9e3779b9;
const NETWORK_SEED_SALT = 0x85ebca6b;
const BYTES_PER_MB = 1024 * 1024;
const MS_PER_SECOND = 1000;
/** Snapshot transfers a saved room's deadline allows for: the start's, and one per chaos event. */
const START_TRANSFERS = 1;

export interface LabHooks {
  /** Called about every `progressEveryTicks` relay ticks with a one-line status. */
  readonly progress?: (line: string) => void;
  readonly progressEveryTicks?: number;
}

const DEFAULT_PROGRESS_TICKS = 500;

type LabStage = Stage & { readonly relay: MeteredRelay };

/** The save a room starts from, as its creator prepares it. */
interface SavedStart {
  readonly path: string;
  readonly save: SaveGame;
  readonly initial: Awaited<ReturnType<typeof prepareInitialSave>>;
  /** Wall ms to inflate and parse the file as a client decodes a served snapshot. */
  readonly decodeMs: number;
  readonly fileBytes: number;
}

async function loadSavedStart(path: string): Promise<SavedStart> {
  const file = readFileSync(path);
  const text = bytesToBase64(file);
  const decodeStart = performance.now();
  const save = await decodeSnapshot(text);
  const decodeMs = performance.now() - decodeStart;
  if (save.header.mapId === null) throw new Error(`${path} names no map`);
  return { path, save, initial: await prepareInitialSave(save), decodeMs, fileBytes: file.byteLength };
}

/** The lobby a saved room walks: as a fresh one, with the creator's initial-save upload and every
 *  member's report of that save before anyone is ready. The upload crosses every link before Ready. */
async function assembleSavedRoom(
  stage: LabStage,
  clients: readonly HeadlessClient[],
  plan: RoomPlan,
  saved: SavedStart,
  deadlineMs: number,
): Promise<void> {
  const [host, ...guests] = clients;
  if (host === undefined) throw new Error('a room needs a creator');
  for (const client of clients) client.hello();
  settle(stage, plan.settleMs);
  host.createRoom(plan.settings, plan.seats);
  settle(stage, plan.settleMs);
  const roomId = host.room?.id;
  if (roomId === undefined)
    throw new Error(`${host.nick} created no room: ${JSON.stringify(host.rejections)}`);
  for (const guest of guests) guest.joinRoom(roomId);
  settle(stage, plan.settleMs);
  clients.forEach((client, index) => {
    client.claimSeat(plan.seatOf(index));
  });
  settle(stage, plan.settleMs);
  const { identity, bytes } = saved.initial;
  host.sendBlob({ type: 'initialSave', to: null, tick: identity.tick, bytes });
  for (const client of clients)
    client.setCompatibility({ ...TEST_COMPATIBILITY, save: identity.fingerprint });
  const holds = (client: HeadlessClient): boolean => client.blobs.some((blob) => blob.type === 'initialSave');
  while (!clients.every(holds)) {
    if (stage.clock.now() > deadlineMs) {
      const missing = clients.filter((client) => !holds(client)).map((client) => client.nick);
      throw new Error(`the initial save did not reach ${missing.join(', ')} by the deadline`);
    }
    settle(stage, NETWORK_STEP_MS);
  }
  settle(stage, plan.settleMs);
  for (const [index, client] of clients.entries()) if (plan.seatOf(index) !== null) client.setReady(true);
  settle(stage, plan.settleMs);
  host.start();
  settle(stage, plan.settleMs);
  await Promise.all(clients.map((client) => client.settled()));
  for (const client of clients) {
    if (client.session === null)
      throw new Error(`${client.nick} got no session: ${JSON.stringify(client.rejections)}`);
  }
}

/** Scripted disturbances in firing order, and the ones whose end is due. */
class ChaosSchedule {
  private readonly pending: ChaosEvent[];
  private readonly ends: { readonly atMs: number; readonly run: () => void }[] = [];
  readonly fired: { readonly event: ChaosEvent; readonly relayTick: number; readonly virtualMs: number }[] =
    [];

  constructor(
    events: readonly ChaosEvent[],
    /** The tick the room started at; an event's tick counts from it. */
    private readonly startTick: number,
    private readonly stage: LabStage,
    private readonly probes: readonly ClientProbe[],
    private readonly links: Link[],
    /** A new client for a reloaded page of the probe numbered `index`. */
    private readonly reloadedClient: (index: number) => HeadlessClient,
  ) {
    this.pending = [...events].sort((a, b) => a.atTick - b.atTick || a.client - b.client);
  }

  run(): void {
    const now = this.stage.clock.now();
    const relayTick = this.stage.relay.clockTick;
    while (this.startTick + (this.pending[0]?.atTick ?? Number.POSITIVE_INFINITY) <= relayTick) {
      const event = this.pending.shift();
      if (event !== undefined) this.start(event, now, relayTick);
    }
    const due = this.ends.filter((end) => end.atMs <= now);
    if (due.length === 0) return;
    this.ends.splice(0, this.ends.length, ...this.ends.filter((end) => end.atMs > now));
    for (const end of due) end.run();
  }

  private start(event: ChaosEvent, now: number, relayTick: number): void {
    const probe = this.probes[event.client];
    const link = this.links[event.client];
    if (probe === undefined || link === undefined) throw new Error(`chaos names no client ${event.client}`);
    this.fired.push({ event, relayTick, virtualMs: now });
    const later = (run: () => void): void => {
      this.ends.push({ atMs: now + event.ms, run });
    };
    switch (event.kind) {
      case 'freeze':
        probe.freeze();
        later(() => probe.thaw());
        return;
      case 'cut':
        probe.disturbed = true;
        link.cut();
        later(() => {
          link.close();
          this.reconnect(probe);
        });
        return;
      case 'relink':
        probe.disturbed = true;
        link.close();
        later(() => this.reconnect(probe));
        return;
      case 'reload':
        probe.disturbed = true;
        link.close();
        later(() => {
          probe.reload(this.reloadedClient(probe.index));
          this.reconnect(probe);
        });
        return;
    }
  }

  private reconnect(probe: ClientProbe): void {
    probe.dropStamps();
    this.links[probe.index] = linkProbe(this.stage, probe);
    probe.client.hello();
    probe.disturbed = false;
  }
}

function linkProbe(stage: LabStage, probe: ClientProbe): Link {
  return stage.relay.linkAs(probe.client.nick, () => stage.network.link(probe.linked, probe.link));
}

/** How far each client trails the relay's clock right now, and what it holds buffered. */
function sample(stage: LabStage, probes: readonly ClientProbe[], startTick: number): TimelineSample {
  const relayTick = stage.relay.clockTick;
  return {
    virtualMs: stage.clock.now(),
    relayTick,
    behind: probes.map((probe) => relayTick - (probe.standing ?? startTick)),
    buffered: probes.map((probe) => probe.client.bufferedTicks),
  };
}

/** Play the configured session for `config.ticks` on every client and report what it cost. */
export async function runLab(config: LabConfig, hooks: LabHooks = {}): Promise<LabReport> {
  const startedAtMs = Date.now();
  const startMs = performance.now();
  const calibrationBeforeMs = calibrationMs();
  let worstLoad = loadPerCpu();
  const saved = config.save === null ? null : await loadSavedStart(config.save);
  const mapId = saved?.save.header.mapId ?? config.mapId;
  const startTick = saved?.save.header.tick ?? 0;
  const endTick = startTick + config.ticks;
  const { setup, seats }: RoomSeats =
    saved === null
      ? labSeats({ ...config, mapId })
      : savedLabSeats(saved.save, config.humans, config.computers);
  const boot = await worldBoot(mapId);
  const clock = new VirtualClock();
  const relay = new MeteredRelay({ now: clock.now });
  const stage: LabStage = {
    clock,
    relay,
    network: new VirtualNetwork(clock, relay, seededRandom(config.seed ^ NETWORK_SEED_SALT)),
  };
  const buildWorld = async (session: GameSession): Promise<Simulation> =>
    buildRelayedMapWorld(boot(session), null, null).sim;
  let probes: ClientProbe[] = [];
  const clientOf = (index: number): HeadlessClient =>
    new HeadlessClient({
      token: `net-lab-client-${index}-token-0123456789`,
      nick: `Gracz ${index}`,
      buildWorld,
      restoreWorld: async (session, save) => {
        const restoreStart = performance.now();
        const { sim } = buildRelayedMapWorld(boot(session), save, serializeSaveGame(save));
        probes[index]?.restored(save.header.tick, performance.now() - restoreStart);
        return sim;
      },
      now: clock.now,
    });
  probes = config.links.map(
    (link, index) =>
      new ClientProbe(
        index,
        clientOf(index),
        link,
        clock.now,
        seededRandom((config.seed + Math.imul(index + 1, ORDER_SEED_SALT)) >>> 0),
        { ordersPerMinute: config.ordersPerMinute, weights: config.orderWeights, lastTick: endTick },
        config.systems,
      ),
  );
  const links = probes.map((probe) => linkProbe(stage, probe));
  const slowestTripMs = Math.max(...config.links.map((link) => link.latencyMs + link.jitterMs));
  const slowestDownload = Math.min(...config.links.map((link) => link.downloadBytesPerSecond));
  const creatorLink = config.links[0];
  if (creatorLink === undefined) throw new Error('a room needs a creator');
  // A saved start's snapshot first crosses the creator's uplink whole, since the relay forwards a blob
  // only once all of it arrived; then it crosses the slowest downlink, and again once per chaos event.
  const snapshotBytes = saved?.initial.bytes.length ?? 0;
  const transferMs =
    (snapshotBytes * MS_PER_SECOND) / creatorLink.uploadBytesPerSecond +
    ((START_TRANSFERS + config.chaos.length) * snapshotBytes * MS_PER_SECOND) / slowestDownload;
  const clients = probes.map((probe) => probe.client);
  const buildStartMs = performance.now();
  const settings: RoomSettings = {
    name: `net-lab ${mapId}`,
    world: { kind: 'map', mapId },
    seed: saved?.save.header.seed ?? config.seed,
    rules: saved === null ? roomRules() : savedRules(saved.save),
    speed: config.speed,
    kickedSeatMode: 'idle',
    ...(saved === null ? {} : { initialSave: saved.initial.identity }),
  };
  const plan: RoomPlan = {
    settings,
    seats: setup,
    seatOf: (index) => seats.human[index] ?? null,
    settleMs: LOBBY_SETTLE_MS + 2 * slowestTripMs,
  };
  if (saved === null) await assembleRoom(stage, clients, plan);
  else await assembleSavedRoom(stage, clients, plan, saved, clock.now() + transferMs + DEADLINE_SLACK_MS);
  const assembleSeconds = (performance.now() - buildStartMs) / 1000;

  const chaos = new ChaosSchedule(config.chaos, startTick, stage, probes, links, clientOf);
  const chaosMs = config.chaos.reduce((sum, event) => sum + event.ms, 0);
  const runMs = (config.ticks * TICK_MS) / config.speed;
  const deadline = clock.now() + runMs * DEADLINE_FACTOR + DEADLINE_SLACK_MS + chaosMs + transferMs;
  const deliverMs: number[] = [];
  const relayMs: number[] = [];
  const timeline: TimelineSample[] = [];
  let nextSampleAt = clock.now();
  let nextProgressTick = startTick + (hooks.progressEveryTicks ?? DEFAULT_PROGRESS_TICKS);
  let peakRssMb = 0;
  const loopStartMs = performance.now();
  try {
    while (probes.some((probe) => probe.capture === null)) {
      if (clock.now() > deadline) {
        const standings = probes.map((probe) => `${probe.client.nick}@${probe.client.tick}`).join(', ');
        throw new Error(`not every client reached tick ${endTick} by the deadline: ${standings}`);
      }
      clock.tick(NETWORK_STEP_MS);
      const deliverStart = performance.now();
      stage.network.flush();
      const relayStart = performance.now();
      relay.advance();
      relayMs.push(performance.now() - relayStart);
      deliverMs.push(relayStart - deliverStart);
      chaos.run();
      for (const probe of probes) probe.advance(NETWORK_STEP_MS);
      await Promise.all(probes.map((probe) => probe.client.settled()));
      for (const probe of probes) {
        probe.maxBehind = Math.max(probe.maxBehind, relay.clockTick - (probe.standing ?? startTick));
      }
      if (clock.now() >= nextSampleAt) {
        timeline.push(sample(stage, probes, startTick));
        nextSampleAt += config.sampleMs;
        peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage.rss() / BYTES_PER_MB));
        worstLoad = Math.max(worstLoad ?? 0, loadPerCpu() ?? 0);
      }
      if (relay.clockTick >= nextProgressTick && hooks.progress !== undefined) {
        nextProgressTick += hooks.progressEveryTicks ?? DEFAULT_PROGRESS_TICKS;
        const ticks = probes.map((probe) => probe.client.tick ?? 0).join('/');
        const wall = ((performance.now() - loopStartMs) / 1000).toFixed(1);
        hooks.progress(
          `relay tick ${relay.clockTick}  clients ${ticks}  wall ${wall} s  rss ${peakRssMb} MB`,
        );
      }
    }
  } finally {
    for (const probe of probes) probe.dispose();
  }
  peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage.rss() / BYTES_PER_MB));
  worstLoad = Math.max(worstLoad ?? 0, loadPerCpu() ?? 0);
  const world: LabWorld = {
    mapId,
    startTick,
    endTick,
    seed: settings.seed,
    save:
      saved === null
        ? null
        : { path: saved.path, fileBytes: saved.fileBytes, initialSaveBytes: saved.initial.bytes.length },
  };
  return buildReport({
    config,
    world,
    seats,
    probes,
    relay,
    timeline,
    deliverMs,
    relayMs,
    chaos: chaos.fired,
    virtualMs: clock.now(),
    wall: {
      startedAtMs,
      totalSeconds: (performance.now() - startMs) / 1000,
      assembleSeconds,
      runSeconds: (performance.now() - loopStartMs) / 1000,
      saveDecodeMs: saved?.decodeMs ?? null,
      peakRssMb,
      loadPerCpu: worstLoad === 0 ? null : worstLoad,
      calibration: { beforeMs: calibrationBeforeMs, afterMs: calibrationMs() },
    },
  });
}
