import { TICKS_PER_SECOND } from '@open-northland/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leadTickLimit } from '../src/session/worker/serve.js';
import type { WorkerSession } from '../src/session/worker/worker-session.js';
import { bundleTestWorker, startTestSession } from './support/session-worker/start-worker.js';
import type { TestWorldBoot } from './support/session-worker/test-world.js';

/**
 * The worker's clock against the frames the runtime draws, over a real worker thread: the worker
 * leads the drawn tick by a couple of frames at most, whatever the frame rate, and a sim slower than
 * its clock slows the clock instead of idling.
 */

const WORKER_BUNDLE_TIMEOUT_MS = 60_000;
const DISPLAY_FRAME_MS = 1000 / 60;
/** A main thread busy for most of a frame, as a late-game view at x10 can be. */
const SLOW_FRAME_MS = 120;
const FAST_SPEED = 30;
const SLOW_FRAMES_SPEED = 10;
/** Frames before a measurement, so the clock has started and the first frame interval is reported. */
const WARM_UP_FRAMES = 10;
const MEASURED_FRAMES = 60;
const SLOW_MEASURED_FRAMES = 12;
/** The share of the deliverable ticks the slow-frame run delivers even when the test machine's load
 *  delays its frames and the clock slows with them. Holding a frame's step cap delivered about 0.35. */
const DELIVERED_SHARE = 0.6;
/** A sim step well over the tick period at the stub's speed and long beside the worker's own work
 *  around it, so its debt passes a frame's cap of ticks and is written off within the run. */
const SLOW_STEP_MS = 40;
const SLOW_STEP_SPEED = 3;
const SLOW_STEP_FRAMES = 120;
/** The least share of wall time a sim-bound worker spends stepping: close to one tick per step cost.
 *  Sleeping a tick period after every five steps would leave about 0.88; a quiet machine reaches about
 *  0.97, and the worker's own work around each step grows on a loaded one. */
const SIM_BOUND_BUSY_SHARE = 0.8;

const SANDBOX: TestWorldBoot = { kind: 'scene', id: 'sandbox' };

interface FrameRecord {
  readonly elapsedMs: number;
  readonly ticks: number;
  readonly simMs: number;
  readonly batches: number;
  readonly leadTicks: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stand in for a display drawing every `frameMs`: each frame advances with its real interval, as the
 *  frame loop does. */
async function playFrames(
  session: WorkerSession<null>,
  frameMs: number,
  count: number,
): Promise<FrameRecord[]> {
  const frames: FrameRecord[] = [];
  let lastMs = performance.now();
  for (let i = 0; i < count; i++) {
    await sleep(frameMs);
    const nowMs = performance.now();
    let ticks = 0;
    session.driver.advance(nowMs - lastMs, () => ticks++);
    const { simMs, batches, leadTicks } = session.offThreadTickCost();
    frames.push({ elapsedMs: nowMs - lastMs, ticks, simMs, batches, leadTicks });
    lastMs = nowMs;
  }
  return frames;
}

const total = (frames: readonly FrameRecord[], of: (frame: FrameRecord) => number): number =>
  frames.reduce((sum, frame) => sum + of(frame), 0);

function deliveredTicksPerSecond(frames: readonly FrameRecord[]): number {
  return total(frames, (frame) => frame.ticks) / (total(frames, (frame) => frame.elapsedMs) / 1000);
}

function longestFrameMs(frames: readonly FrameRecord[]): number {
  return Math.max(...frames.map((frame) => frame.elapsedMs));
}

/** Change the clock, then draw until the tick the worker stood at once it took the change shows: the
 *  ticks the runtime is shown after the change that the worker stepped before it. */
async function ticksShownAfter(
  session: WorkerSession<null>,
  frameMs: number,
  change: () => void,
): Promise<number> {
  const drawnAtChange = session.host.tick;
  change();
  // Answered after the change: a pause steps nothing past it, a slower clock at most a tick.
  const steppedTo = (await session.host.hashState()).tick;
  while (session.host.tick < steppedTo) await playFrames(session, frameMs, 1);
  return steppedTo - drawnAtChange;
}

const pause = (session: WorkerSession<null>) => () => session.driver.setPaused(true);

describe('worker pacing', () => {
  let bundle: Awaited<ReturnType<typeof bundleTestWorker>>;
  beforeAll(async () => {
    bundle = await bundleTestWorker();
  }, WORKER_BUNDLE_TIMEOUT_MS);
  afterAll(() => bundle.dispose());

  it('leads the drawn tick by two frames at most at x30 and 60 frames a second, one batch a frame', async () => {
    const session = await startTestSession(bundle.path, SANDBOX, { speed: FAST_SPEED, paused: false });
    try {
      const warmUp = await playFrames(session, DISPLAY_FRAME_MS, WARM_UP_FRAMES);
      const frames = await playFrames(session, DISPLAY_FRAME_MS, MEASURED_FRAMES);
      // The lead a batch reports was stepped under the limit of an earlier frame's interval.
      const limit = leadTickLimit(FAST_SPEED, longestFrameMs([...warmUp, ...frames]));
      expect(Math.max(...frames.map((frame) => frame.leadTicks))).toBeLessThanOrEqual(limit);
      expect(Math.max(...frames.map((frame) => frame.batches))).toBe(1);
      expect(await ticksShownAfter(session, DISPLAY_FRAME_MS, pause(session))).toBeLessThanOrEqual(limit);
    } finally {
      session.dispose();
    }
  });

  it('keeps the requested speed under slow frames without banking ticks past a pause', async () => {
    const session = await startTestSession(bundle.path, SANDBOX, { speed: SLOW_FRAMES_SPEED, paused: false });
    try {
      const warmUp = await playFrames(session, SLOW_FRAME_MS, WARM_UP_FRAMES);
      const frames = await playFrames(session, SLOW_FRAME_MS, SLOW_MEASURED_FRAMES);
      const limit = leadTickLimit(SLOW_FRAMES_SPEED, longestFrameMs([...warmUp, ...frames]));
      expect(Math.max(...frames.map((frame) => frame.leadTicks))).toBeLessThanOrEqual(limit);
      // Against what the worker's own steps allow, which a loaded machine cuts below the request.
      const stepsAllow =
        1000 / (total(frames, (frame) => frame.simMs) / total(frames, (frame) => frame.ticks));
      const deliverable = Math.min(SLOW_FRAMES_SPEED * TICKS_PER_SECOND, stepsAllow);
      expect(deliveredTicksPerSecond(frames)).toBeGreaterThan(deliverable * DELIVERED_SHARE);

      expect(await ticksShownAfter(session, SLOW_FRAME_MS, pause(session))).toBeLessThanOrEqual(limit);
    } finally {
      session.dispose();
    }
  });

  it('delivers the lower speed once the ticks stepped before a speed-down have shown', async () => {
    const session = await startTestSession(bundle.path, SANDBOX, { speed: FAST_SPEED, paused: false });
    try {
      const warmUp = await playFrames(session, DISPLAY_FRAME_MS, WARM_UP_FRAMES);
      const slowDown = () => session.driver.setSpeed(1);
      expect(await ticksShownAfter(session, DISPLAY_FRAME_MS, slowDown)).toBeLessThanOrEqual(
        leadTickLimit(FAST_SPEED, longestFrameMs(warmUp)),
      );
      const frames = await playFrames(session, DISPLAY_FRAME_MS, MEASURED_FRAMES);
      const seconds = total(frames, (frame) => frame.elapsedMs) / 1000;
      // One tick of slack for where the window's edges cut the tick period.
      expect(total(frames, (frame) => frame.ticks)).toBeLessThanOrEqual(
        Math.ceil(seconds * TICKS_PER_SECOND) + 1,
      );
    } finally {
      session.dispose();
    }
  });

  it('slows the clock to a sim slower than its tick period, stepping without idling', async () => {
    const session = await startTestSession(
      bundle.path,
      { ...SANDBOX, stepMs: SLOW_STEP_MS },
      { speed: SLOW_STEP_SPEED, paused: false },
    );
    try {
      await playFrames(session, DISPLAY_FRAME_MS, WARM_UP_FRAMES);
      const frames = await playFrames(session, DISPLAY_FRAME_MS, SLOW_STEP_FRAMES);
      // Timed by the worker's own step times, so a loaded machine slowing the steps does not count.
      const busy = total(frames, (frame) => frame.simMs) / total(frames, (frame) => frame.elapsedMs);
      expect(busy).toBeGreaterThan(SIM_BOUND_BUSY_SHARE);
      // The shortfall is reported as the clock's dropped ticks.
      expect(session.driver.droppedTicks).toBeGreaterThan(0);
    } finally {
      session.dispose();
    }
  });
});
