import { fileURLToPath } from 'node:url';
import type { GameSession } from '@open-northland/lockstep';
import { type RoomSeatSetup, type RoomSettings, TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { GOVERN_BEHIND_MS, Relay } from '@open-northland/net-server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import type { Stage } from '../../../net-server/test/support/session-run.js';
import { VirtualClock, VirtualNetwork } from '../../../net-server/test/support/virtual-network.js';
import { buildRelayedMapWorld, type MapWorkerBoot } from '../../src/entries/map/world-inputs.js';
import { UNDELIVERED_LIMIT_SECONDS } from '../../src/session/worker/serve.js';
import { assemblePacedRoom, PacedStage } from '../support/net-worker/paced-stage.js';
import { type RecordedAck, WorkerHeadlessClient } from '../support/net-worker/worker-headless-client.js';
import { canonicalEntities } from '../support/session-worker/canonical-entities.js';
import { bundleTestWorker } from '../support/session-worker/start-worker.js';

/**
 * A relayed runtime that stops drawing does not stop its client. The network worker's client keeps
 * running the relay's frames and acknowledging them while the runtime delivers nothing: the relay never
 * waits for it, and past the undelivered limit the worker sheds the oldest records it holds, so the
 * runtime's mirror catches up exactly once it draws again.
 *
 * The room is an inline headless client and a worker-hosted one on the map-less fallback world, so the
 * file runs without generated content. See `PacedStage` for how real and virtual time are kept in step.
 */

const NET_WORKER_ENTRY = fileURLToPath(new URL('../support/net-worker/node-net-worker.ts', import.meta.url));
const WORKER_BUNDLE_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;
const MS_PER_SECOND = 1000;
/** Four times the base rate, so a short stall window holds several acknowledgements. */
const SESSION_SPEED = 4;
const LINK = { latencyMs: 20, jitterMs: 4 };
const SEATS: readonly RoomSeatSetup[] = [
  { player: 0, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 0 },
  { player: 1, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 1 },
];
const OWNER_SEAT = 0;
const SETTINGS: RoomSettings = {
  name: 'Zastój',
  world: { kind: 'map', mapId: 'zatoka' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null },
  speed: SESSION_SPEED,
};
const STEP_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 30_000;
const CATCH_UP_TIMEOUT_MS = 10_000;
/** One second of the session, played before the first stall. */
const WARMUP_TICKS = TICKS_PER_SECOND * SESSION_SPEED;
/** The runtime stops delivering for `SHORT_STALL_MS` once every `STALL_CYCLE_MS`, this many times. */
const SHORT_STALLS = 3;
const STALL_CYCLE_MS = 1000;
const SHORT_STALL_MS = 200;
const STALL_MARGIN_MS = 500;
/** Past the undelivered limit and the relay's lag allowance together: a worker that held its clock at
 *  the limit would be listed slow before this stall ends. */
const LONG_STALL_MS = UNDELIVERED_LIMIT_SECONDS * MS_PER_SECOND + GOVERN_BEHIND_MS + STALL_MARGIN_MS;
/** The longest silence between two acknowledgements the cadence allows on a loaded machine; a worker
 *  holding at the undelivered limit would go quiet for seconds. */
const MAX_ACK_GAP_MS = 500;
/** The share of the frames the relay sent during the long stall that the worker must acknowledge in
 *  it; one holding at the limit would reach well under half. */
const MIN_ACKED_SHARE = 0.75;
/** Real time for the frames in flight to land once the relay holds. */
const LINK_DRAIN_MS = 200;

/** The map-less fallback world. It gives its settlement to the local seat, so every client builds it
 *  as the first seat's and the two worlds agree. */
function fallbackBoot(session: GameSession): MapWorkerBoot {
  return {
    map: null,
    ir: null,
    script: null,
    goodNames: new Map(),
    content: null,
    session: { ...session, localSeat: OWNER_SEAT },
    missions: null,
    saveText: null,
  };
}

function stageFor(): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay) };
}

interface StallWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** The last acknowledgement at or before `atMs`. */
function ackedAt(acks: readonly RecordedAck[], atMs: number): number {
  let tick = 0;
  for (const ack of acks) if (ack.atMs <= atMs) tick = ack.tick;
  return tick;
}

/** The longest gap between acknowledgements across `window`, its edges included. */
function longestAckGap(acks: readonly RecordedAck[], window: StallWindow): number {
  const times = [
    window.startMs,
    ...acks.map((ack) => ack.atMs).filter((at) => at > window.startMs && at < window.endMs),
    window.endMs,
  ];
  let longest = 0;
  for (let i = 1; i < times.length; i++) longest = Math.max(longest, (times[i] ?? 0) - (times[i - 1] ?? 0));
  return longest;
}

let bundle: Awaited<ReturnType<typeof bundleTestWorker>>;
beforeAll(async () => {
  bundle = await bundleTestWorker(NET_WORKER_ENTRY);
}, WORKER_BUNDLE_TIMEOUT_MS);
afterAll(() => bundle.dispose());

it('keeps acknowledging while its runtime stalls, and sheds only past the undelivered limit', {
  timeout: TEST_TIMEOUT_MS,
}, async () => {
  const stage = stageFor();
  const peer = new HeadlessClient({
    token: 'token-peer-0123456789',
    nick: 'Ania',
    buildWorld: async (session) => buildRelayedMapWorld(fallbackBoot(session), null).sim,
    restoreWorld: async (session, save) => buildRelayedMapWorld(fallbackBoot(session), save).sim,
  });
  const hosted = new WorkerHeadlessClient({
    workerPath: bundle.path,
    token: 'token-hosted-0123456789',
    nick: 'Bartek',
    boot: fallbackBoot,
  });
  try {
    stage.network.link(peer, LINK);
    stage.network.link(hosted, LINK);
    const paced = new PacedStage(stage, [peer], [hosted]);
    await assemblePacedRoom(paced, [peer, hosted], {
      settings: SETTINGS,
      seats: SEATS,
      seatOf: (index) => SEATS[index]?.player ?? -1,
      stepTimeoutMs: STEP_TIMEOUT_MS,
    });
    await paced.until(
      'both clients hold the world',
      () => peer.sim !== null && hosted.world !== null,
      OPEN_TIMEOUT_MS,
    );
    await paced.until(
      'the session is under way',
      () => (peer.tick ?? 0) >= WARMUP_TICKS && hosted.ackedTick >= WARMUP_TICKS,
      STEP_TIMEOUT_MS,
    );
    const waitsBefore = peer.waits.length;

    const stall = async (ms: number): Promise<StallWindow & { readonly framed: number }> => {
      const framedBefore = hosted.lastFrameTick;
      hosted.stalled = true;
      const startMs = performance.now();
      await paced.runFor(ms);
      const endMs = performance.now();
      hosted.stalled = false;
      return { startMs, endMs, framed: hosted.lastFrameTick - framedBefore };
    };

    const shortStalls: StallWindow[] = [];
    for (let i = 0; i < SHORT_STALLS; i++) {
      await paced.runFor(STALL_CYCLE_MS - SHORT_STALL_MS);
      shortStalls.push(await stall(SHORT_STALL_MS));
    }
    await paced.runFor(STALL_CYCLE_MS - SHORT_STALL_MS);
    const shedBeforeLongStall = hosted.batches.reduce((sum, batch) => sum + batch.shedTicks, 0);
    const longStall = await stall(LONG_STALL_MS);
    const ackedAtStallEnd = hosted.ackedTick;
    await paced.until(
      'the mirror catches up with the acknowledged tick',
      () => (hosted.tick ?? 0) >= ackedAtStallEnd,
      CATCH_UP_TIMEOUT_MS,
    );

    // Acknowledgements keep their cadence through every stall, and the relay never waits for the client.
    for (const window of [...shortStalls, longStall]) {
      expect(ackedAt(hosted.acks, window.endMs)).toBeGreaterThan(ackedAt(hosted.acks, window.startMs));
      expect(longestAckGap(hosted.acks, window)).toBeLessThan(MAX_ACK_GAP_MS);
    }
    const ackedInLongStall = ackedAt(hosted.acks, longStall.endMs) - ackedAt(hosted.acks, longStall.startMs);
    expect(ackedInLongStall).toBeGreaterThanOrEqual(longStall.framed * MIN_ACKED_SHARE);
    const waitedFor = peer.waits.slice(waitsBefore).filter((notice) => notice.for.length > 0);
    expect(waitedFor).toEqual([]);

    // A stall shorter than the limit sheds nothing; the long one does.
    expect(shedBeforeLongStall).toBe(0);
    const shed = hosted.batches.reduce((sum, batch) => sum + batch.shedTicks, 0);
    expect(shed).toBeGreaterThan(0);

    // Both clients come to rest on the relay's last frame: the mirror spans every tick the worker
    // stepped, delivered or shed, and stands where the peer's sim does.
    paced.relayHeld = true;
    await paced.runFor(LINK_DRAIN_MS);
    const rested = (): boolean =>
      hosted.ackedTick === hosted.lastFrameTick &&
      hosted.tick === hosted.lastFrameTick &&
      peer.tick === hosted.lastFrameTick;
    await paced.until('both clients rest on the last frame', rested, CATCH_UP_TIMEOUT_MS);
    const lastTick = hosted.lastFrameTick;
    const stepped = hosted.batches.reduce((sum, batch) => sum + batch.ticks + batch.shedTicks, 0);
    expect(stepped).toBe(lastTick - (hosted.openedAtTick ?? 0));
    const world = hosted.world;
    const sim = peer.sim;
    if (world === null || sim === null) throw new Error('a client lost its world');
    expect(await world.session.host.hashState()).toEqual({ tick: lastTick, hash: sim.hashState() });
    expect(canonicalEntities(world.session.host.snapshot())).toBe(canonicalEntities(sim.snapshot()));
    expect(hosted.failures).toEqual([]);
    expect(hosted.rejections).toEqual([]);
    expect(peer.rejections).toEqual([]);
    expect(peer.desyncs).toEqual([]);
  } finally {
    hosted.dispose();
  }
});
