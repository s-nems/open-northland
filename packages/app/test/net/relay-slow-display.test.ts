import { fileURLToPath } from 'node:url';
import type { GameSession } from '@open-northland/lockstep';
import { type RoomSeatSetup, type RoomSettings, TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { MIN_GOVERNED_SPEED, Relay } from '@open-northland/net-server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import type { Stage } from '../../../net-server/test/support/session-run.js';
import { VirtualClock, VirtualNetwork } from '../../../net-server/test/support/virtual-network.js';
import { buildRelayedMapWorld, type MapWorkerBoot } from '../../src/entries/map/world-inputs.js';
import { assemblePacedRoom, PacedStage } from '../support/net-worker/paced-stage.js';
import { WorkerHeadlessClient } from '../support/net-worker/worker-headless-client.js';
import { canonicalEntities } from '../support/session-worker/canonical-entities.js';
import { bundleTestWorker } from '../support/session-worker/start-worker.js';

/**
 * A relayed runtime that draws slower than the room's speed slows the room. The network worker steps
 * only a couple of frames past the tick its runtime drew, so its acknowledgements fall behind the
 * relay's clock, and its load reports what a tick costs the display: the relay lists it slow and
 * governs the clock below the rate it draws, so it stops falling further behind. Once it draws at full rate again the room is released, and
 * the runtime's mirror has seen every tick.
 *
 * The room is an inline headless client and a worker-hosted one on the map-less fallback world, so the
 * file runs without generated content. See `PacedStage` for how real and virtual time are kept in step.
 */

const NET_WORKER_ENTRY = fileURLToPath(new URL('../support/net-worker/node-net-worker.ts', import.meta.url));
const WORKER_BUNDLE_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
/** Four times the base rate, so the slow display falls behind within seconds. */
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
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: SESSION_SPEED,
};
const HOSTED_NICK = 'Bartek';
const STEP_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 30_000;
const GOVERN_TIMEOUT_MS = 20_000;
const CATCH_UP_TIMEOUT_MS = 20_000;
/** One second of the session, played before the display slows. */
const WARMUP_TICKS = TICKS_PER_SECOND * SESSION_SPEED;
/** The slow display's frame interval: past the worker's longest lead frame, so each frame takes in
 *  fewer ticks than the requested speed plays in it. */
const SLOW_FRAME_MS = 2000;
/** Time for the governed speed to settle once the relay first governs, as the display's cost does. */
const SETTLE_MS = 8000;
/** Each of the two windows whose mean acknowledgement lag is compared: several slow frames, so the
 *  lag's saw-tooth over a frame averages out. */
const LAG_WINDOW_MS = 6000;
/** Real time for the frames in flight to land once the relay holds. */
const LINK_DRAIN_MS = 200;

/** The map-less fallback world. It gives its settlement to the local seat, so every client builds it
 *  as the first seat's and the two worlds agree. */
function fallbackBoot(session: GameSession): MapWorkerBoot {
  return {
    map: null,
    ir: null,
    script: null,
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

let bundle: Awaited<ReturnType<typeof bundleTestWorker>>;
beforeAll(async () => {
  bundle = await bundleTestWorker(NET_WORKER_ENTRY);
}, WORKER_BUNDLE_TIMEOUT_MS);
afterAll(() => bundle.dispose());

it('governs the room to the rate a slow display draws, and releases it once the display recovers', {
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
    nick: HOSTED_NICK,
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
    expect(peer.governed).toBeNull();

    hosted.frameMs = SLOW_FRAME_MS;
    await paced.until(
      'the relay governs the room for the slow display',
      () => peer.governed?.nick === HOSTED_NICK,
      GOVERN_TIMEOUT_MS,
    );
    // The relay slows at once on each load report, so the governed speed comes down as the display's
    // cost settles. Then the room runs no faster than the display draws: the lag stops growing.
    await paced.runFor(SETTLE_MS);
    const lagWindow = async (): Promise<number> => {
      const lags: number[] = [];
      const end = performance.now() + LAG_WINDOW_MS;
      while (performance.now() < end) {
        await paced.turn();
        lags.push((peer.tick ?? 0) - hosted.ackedTick);
      }
      return lags.reduce((sum, lag) => sum + lag, 0) / lags.length;
    };
    const earlierLag = await lagWindow();
    const laterLag = await lagWindow();
    expect(laterLag).toBeLessThanOrEqual(earlierLag);
    expect(peer.governed?.nick).toBe(HOSTED_NICK);
    expect(peer.governed?.speed).toBeLessThan(SESSION_SPEED);
    expect(peer.governed?.speed).toBeGreaterThan(MIN_GOVERNED_SPEED);
    expect(peer.waits.at(-1)?.for).toEqual([]);

    hosted.frameMs = null;
    await paced.until(
      'the room is released once the display draws at full rate',
      () => peer.governed === null && peer.waits.at(-1)?.for.length === 0,
      CATCH_UP_TIMEOUT_MS,
    );

    // Both clients come to rest on the relay's last frame, and the runtime's mirror saw every tick the
    // worker stepped.
    paced.relayHeld = true;
    await paced.runFor(LINK_DRAIN_MS);
    const rested = (): boolean =>
      hosted.ackedTick === hosted.lastFrameTick &&
      hosted.tick === hosted.lastFrameTick &&
      peer.tick === hosted.lastFrameTick;
    await paced.until('both clients rest on the last frame', rested, CATCH_UP_TIMEOUT_MS);
    const lastTick = hosted.lastFrameTick;
    const delivered = hosted.batchTicks.reduce((sum, ticks) => sum + ticks, 0);
    expect(delivered).toBe(lastTick - (hosted.openedAtTick ?? 0));
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
