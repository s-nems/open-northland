import type { GameSession } from '@open-northland/lockstep';
import { LINK_REPLACE_MS, RelaySocket, TRANSFER_REPLACE_MS } from '@open-northland/net-client';
import { type ClientMessage, type RoomSettings, TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { components, type Simulation } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeadlessClient } from '../support/headless-client.js';
import { assembleRoom, NETWORK_STEP_MS, runFor, runUntil, type Stage } from '../support/session-run.js';
import { buildTestWorld, restoreTestWorld } from '../support/test-world.js';
import {
  type Link,
  type LinkOptions,
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../support/virtual-network.js';

/** A link that stops carrying anything either way while both ends keep it open, as a router or WiFi
 *  roam leaves it, and the client that replaces it on its own. */

const SETTINGS: RoomSettings = {
  name: 'half-open',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 13,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const SEATS = [0, 1].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle' as const, 'computer' as const],
  color: player,
}));
const LINK: LinkOptions = { latencyMs: 60, jitterMs: 10 };
const SETTLE_MS = 400;
const CACHED_AT_TICK = 30;
const RUN_ON_TICKS = 60;
/** The socket's look at a quiet link, its first retry, and a rejoin's round trips. */
const REJOIN_MS = 4000;
/** Time for the room to show it runs again. */
const RECOVERY_MS = 3000;
/** At least half the ticks of normal speed: the room runs, not merely crawls. */
const RUNNING_TICKS = (RECOVERY_MS / 1000) * (TICKS_PER_SECOND / 2);
/** A downlink on which the heavy snapshot takes longer than a quiet link may last. */
const SLOW_DOWNLINK_BYTES_PER_SECOND = 64 * 1024;
/** Characters of seeded noise one settler's name carries, so the snapshot is about a megabyte. */
const NOISE_CHARACTERS = 1024 * 1024;
const NOISE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Virtual time for the whole snapshot to cross the slow downlink, with margin. */
const SLOW_DOWNLOAD_MS = ((NOISE_CHARACTERS * 2) / SLOW_DOWNLINK_BYTES_PER_SECOND) * 1000;
/** A coarser step while nothing but the relay's clock moves. */
const STALL_STEP_MS = 100;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

async function buildHeavyWorld(session: GameSession): Promise<Simulation> {
  const sim = await buildTestWorld(session);
  const random = seededRandom(session.seed);
  let name = '';
  for (let i = 0; i < NOISE_CHARACTERS; i++)
    name += NOISE_ALPHABET[Math.floor(random() * NOISE_ALPHABET.length)];
  sim.world.add(sim.world.create(), components.ScriptedLook, { recipes: [name] });
  return sim;
}

function client(nick: string, build: typeof buildTestWorld): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld: build,
    restoreWorld: restoreTestWorld,
  });
}

/** A browser socket over one virtual link: whole messages as text, open from the next microtask. */
class VirtualWebSocket {
  readonly OPEN = SOCKET_OPEN;
  readyState = SOCKET_CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  private readonly link: Link;
  private up: ((message: ClientMessage) => void) | null = null;
  private halfOpen = false;

  constructor(network: VirtualNetwork, options: LinkOptions) {
    this.link = network.link(
      {
        receive: (raw) => {
          if (this.readyState === SOCKET_OPEN) this.onmessage?.({ data: JSON.stringify(raw) });
        },
        attach: (send) => {
          this.up = send;
        },
      },
      options,
    );
    queueMicrotask(() => {
      if (this.readyState !== SOCKET_CONNECTING) return;
      this.readyState = SOCKET_OPEN;
      this.onopen?.();
    });
  }

  send(text: string): void {
    const message: ClientMessage = JSON.parse(text);
    this.up?.(message);
  }

  /** Nothing crosses either way any more, and neither end hears of it. */
  stall(): void {
    this.halfOpen = true;
    this.link.cut();
  }

  /** A close on a stalled link never reaches the relay. */
  close(): void {
    this.readyState = SOCKET_CLOSED;
    if (!this.halfOpen) this.link.close();
  }
}

/** `client` plays through a `RelaySocket` from here on, as the app's network worker wires it. */
function socketFor(stage: Stage, player: HeadlessClient, options: LinkOptions) {
  const sockets: VirtualWebSocket[] = [];
  let quietReports = 0;
  const link = new RelaySocket({
    url: 'ws://relay.test',
    now: stage.clock.now,
    createSocket: () => {
      const socket = new VirtualWebSocket(stage.network, options);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    onOpen: () => player.hello(),
    onMessage: (raw) => player.receive(raw),
    onClosed: () => undefined,
    onQuiet: () => quietReports++,
    awaitsTransfer: () => player.awaitsTransfer,
  });
  player.attach((message) => {
    link.send(message);
  });
  return { link, sockets, quietReports: () => quietReports };
}

/** Run the clients and the socket timers on the virtual clock. */
async function play(
  stage: Stage,
  clients: readonly HeadlessClient[],
  ms: number,
  stepMs = NETWORK_STEP_MS,
): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    stage.clock.tick(stepMs);
    stage.network.flush();
    stage.relay.advance();
    vi.advanceTimersByTime(stepMs);
    // A replacement socket opens on a microtask.
    await Promise.resolve();
    for (const each of clients) each.advance(stepMs);
    await Promise.all(clients.map((each) => each.settled()));
  }
}

async function room(seed: number, build: typeof buildTestWorld) {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
  const ania = client('Ania', build);
  const bartek = client('Bartek', build);
  const links = [stage.network.link(ania, LINK), stage.network.link(bartek, LINK)] as const;
  await assembleRoom(stage, [ania, bartek], {
    settings: SETTINGS,
    seats: SEATS,
    seatOf: (i) => i,
    settleMs: SETTLE_MS,
  });
  await runUntil(stage, [ania, bartek], CACHED_AT_TICK);
  ania.receive({ kind: 'snapshotRequest' });
  await ania.settled();
  await runFor(stage, [ania, bartek], SETTLE_MS);
  return { stage, ania, bartek, links };
}

async function expectAgreement(stage: Stage, ania: HeadlessClient, bartek: HeadlessClient): Promise<void> {
  const captures = await runUntil(stage, [ania, bartek], (ania.tick ?? 0) + RUN_ON_TICKS);
  expect(captures.get(bartek)?.hash).toBe(captures.get(ania)?.hash);
  for (const each of [ania, bartek]) {
    expect(each.dropped, each.nick).toEqual([]);
    expect(each.desyncs, each.nick).toEqual([]);
  }
}

describe('a client on a half-open link', () => {
  const opened: RelaySocket[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    for (const link of opened.splice(0)) link.close();
    vi.useRealTimers();
  });

  it('replaces the stalled socket on its own and the room runs again', async () => {
    const { stage, ania, bartek } = await room(5, buildTestWorld);
    const socket = socketFor(stage, bartek, LINK);
    opened.push(socket.link);
    await play(stage, [ania, bartek], SETTLE_MS);
    expect(socket.link.connected).toBe(true);

    socket.sockets[0]?.stall();
    await play(stage, [ania, bartek], LINK_REPLACE_MS + REJOIN_MS);
    expect(socket.sockets).toHaveLength(2);
    expect(ania.waits.flatMap((notice) => notice.for.map((member) => member.reason))).toContain('silent');
    const resumedAt = ania.tick ?? 0;
    await play(stage, [ania, bartek], RECOVERY_MS);
    expect((ania.tick ?? 0) - resumedAt).toBeGreaterThan(RUNNING_TICKS);
    expect(ania.waits.at(-1)?.for).toEqual([]);
    await expectAgreement(stage, ania, bartek);
  });

  it('keeps a quiet socket while the snapshot it asked for is still arriving', async () => {
    const { stage, ania, links } = await room(6, buildHeavyWorld);
    links[1].close();
    const again = client('Bartek', buildHeavyWorld);
    const socket = socketFor(stage, again, {
      ...LINK,
      downloadBytesPerSecond: SLOW_DOWNLINK_BYTES_PER_SECOND,
    });
    opened.push(socket.link);
    await play(stage, [ania, again], SLOW_DOWNLOAD_MS);

    expect(socket.quietReports()).toBeGreaterThan(0);
    expect(socket.sockets).toHaveLength(1);
    expect(again.restoredFrom).toHaveLength(1);
    await expectAgreement(stage, ania, again);
  });

  it('replaces a socket stalled during the awaited snapshot after the longer bound, and is served again', async () => {
    const { stage, ania, links } = await room(7, buildHeavyWorld);
    links[1].close();
    const again = client('Bartek', buildHeavyWorld);
    const socket = socketFor(stage, again, {
      ...LINK,
      downloadBytesPerSecond: SLOW_DOWNLINK_BYTES_PER_SECOND,
    });
    opened.push(socket.link);
    // Past the short bound into the download, then the route falls away. The bound counts from the
    // last message, which came before the snapshot began to cross.
    const intoDownloadMs = LINK_REPLACE_MS + REJOIN_MS;
    await play(stage, [ania, again], intoDownloadMs);
    expect(again.awaitsTransfer).toBe(true);
    expect(socket.quietReports()).toBeGreaterThan(0);
    socket.sockets[0]?.stall();
    await play(stage, [ania, again], TRANSFER_REPLACE_MS - intoDownloadMs - REJOIN_MS, STALL_STEP_MS);
    expect(socket.sockets).toHaveLength(1);
    await play(stage, [ania, again], REJOIN_MS * 2, STALL_STEP_MS);
    expect(socket.sockets).toHaveLength(2);

    await play(stage, [ania, again], SLOW_DOWNLOAD_MS);
    expect(again.restoredFrom).toHaveLength(1);
    await expectAgreement(stage, ania, again);
  });
});
