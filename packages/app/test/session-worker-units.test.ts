import { MessageChannel } from 'node:worker_threads';
import { MS_PER_TICK } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { changedFacts, readWorldFacts } from '../src/session/worker/facts.js';
import type { SessionPort } from '../src/session/worker/port.js';
import type { FromWorker } from '../src/session/worker/protocol.js';
import { ArrivalAlpha } from '../src/session/worker/render-alpha.js';
import {
  serveSession,
  UNDELIVERED_LIMIT_SECONDS,
  undeliveredTickLimit,
} from '../src/session/worker/serve.js';
import { StallWatch } from '../src/session/worker/stall-watch.js';
import { TICK_BATCHES_IN_FLIGHT } from '../src/session/worker/tick-outbox.js';
import { startWorkerSession } from '../src/session/worker/worker-session.js';
import { nodeParentPort } from './support/session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS, SILENT_STALL_REPORTS } from './support/session-worker/start-worker.js';
import { buildTestWorld, type TestWorldBoot } from './support/session-worker/test-world.js';

const SPEED = 2;
const HALF = 0.5;
const PERIOD_MS = MS_PER_TICK / SPEED;

describe('arrival alpha', () => {
  it('runs from 0 at an arrival to 1 a tick period at the session speed later, and clamps there', () => {
    const alpha = new ArrivalAlpha(SPEED, false);
    alpha.arrived(1000);
    expect(alpha.at(1000)).toBe(0);
    expect(alpha.at(1000 + PERIOD_MS * HALF)).toBeCloseTo(HALF);
    expect(alpha.at(1000 + PERIOD_MS * 3)).toBe(1);
  });

  it('holds while paused and continues from the held fraction', () => {
    const alpha = new ArrivalAlpha(SPEED, false);
    alpha.arrived(0);
    alpha.setPaused(true, PERIOD_MS * HALF);
    expect(alpha.at(PERIOD_MS * 10)).toBeCloseTo(HALF);
    alpha.setPaused(false, PERIOD_MS * 10);
    expect(alpha.at(PERIOD_MS * 10)).toBeCloseTo(HALF);
    expect(alpha.at(PERIOD_MS * 10.25)).toBeCloseTo(HALF + 0.25);
  });

  it('keeps its fraction across a speed change and runs the rest at the new pace', () => {
    const alpha = new ArrivalAlpha(1, false);
    alpha.arrived(0);
    alpha.setSpeed(SPEED, MS_PER_TICK * HALF);
    expect(alpha.at(MS_PER_TICK * HALF)).toBeCloseTo(HALF);
    expect(alpha.at(MS_PER_TICK * HALF + PERIOD_MS * 0.25)).toBeCloseTo(HALF + 0.25);
  });
});

describe('stall watch', () => {
  const TIMEOUT_MS = 500;
  const HEARTBEAT_MS = 100;

  function watched() {
    const reports: string[] = [];
    const watch = new StallWatch(
      { stalled: (ms) => reports.push(`stalled ${ms}`), recovered: (ms) => reports.push(`recovered ${ms}`) },
      TIMEOUT_MS,
      HEARTBEAT_MS,
      0,
    );
    return { watch, reports };
  }

  it('reports a silence past the timeout once, and its end', () => {
    const { watch, reports } = watched();
    for (let t = HEARTBEAT_MS; t <= 800; t += HEARTBEAT_MS) watch.check(t);
    watch.heard(900);
    expect(reports).toEqual(['stalled 600', 'recovered 900']);
  });

  it('charges nothing to the worker while this thread was blocked', () => {
    const { watch, reports } = watched();
    watch.check(HEARTBEAT_MS);
    // The next check comes seconds late: the worker's answers sat unread in this thread's queue.
    watch.check(3000);
    watch.check(3000 + HEARTBEAT_MS);
    expect(reports).toEqual([]);
  });
});

describe('world facts', () => {
  const scene = SCENES.find((s) => s.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');

  it('posts only what changed, the plots by identity', () => {
    const sim = createSceneSim(scene);
    sim.run(2);
    const first = readWorldFacts(sim);
    expect(changedFacts(first, readWorldFacts(sim))).toEqual({});
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: !first.needsEnabled });
    sim.step();
    expect(changedFacts(first, readWorldFacts(sim))).toMatchObject({ needsEnabled: !first.needsEnabled });
  });
});

/** Both ends in this thread over a `MessageChannel`, with the runtime's messages counted as they land. */
function inProcessSession(boot: TestWorldBoot, speed = 1, paused = true) {
  const channel = new MessageChannel();
  serveSession(nodeParentPort(channel.port1), buildTestWorld);
  const inner = nodeParentPort(channel.port2);
  const batches: number[] = [];
  const port: SessionPort = {
    post: inner.post,
    listenFailure: inner.listenFailure,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
    listen: (receive) =>
      inner.listen((message, receiveMs) => {
        const landed = message as FromWorker<null>;
        if (landed.kind === 'ticks') batches.push(landed.batch.ticks.length);
        receive(message, receiveMs);
      }),
  };
  const session = startWorkerSession<TestWorldBoot, null>(
    port,
    boot,
    { ...DEFAULT_TEST_OPTIONS, speed, paused },
    SILENT_STALL_REPORTS,
  );
  return { session, batches };
}

const MS_PER_SECOND = 1000;
/** How long past reaching its limit, in the limit's wall time, the hold test watches the worker. */
const PAST_THE_LIMIT = 0.5;
/** How long the hold test waits for the worker to reach its limit on a loaded machine. */
const REACH_LIMIT_TIMEOUT_MS = 30_000;
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** A polling interval while the other end of an in-process channel works. */
const TURN_MS = 10;

describe('tick batch queue', () => {
  it('holds the batches in flight to its bound and posts the rest as one spanning batch', async () => {
    const { session: started, batches } = inProcessSession({ kind: 'scene', id: 'sandbox' });
    const session = await started;
    try {
      const RUN_TICKS = 12;
      const start = session.host.tick;
      const run = session.host.run(RUN_TICKS);
      // The worker answers between the run's slices, so its tick shows how far the run got.
      while ((await session.host.hashState()).tick < start + RUN_TICKS) await settle(TURN_MS);
      expect(batches).toEqual(Array.from({ length: TICK_BATCHES_IN_FLIGHT }, () => 1));

      const ticks: number[] = [];
      const onTick = () => ticks.push(session.host.tick);
      // The held ticks go out in batches of a frame's worth, and a frame delivers one frame's worth.
      const frame = session.driver.maxStepsPerFrame;
      const spanning = Array.from({ length: (RUN_TICKS - TICK_BATCHES_IN_FLIGHT) / frame }, () => frame);
      session.driver.advance(0, onTick);
      while (batches.length < TICK_BATCHES_IN_FLIGHT + spanning.length) {
        session.driver.advance(0, onTick);
        await settle(TURN_MS);
      }
      expect(batches).toEqual([1, 1, ...spanning]);
      while (ticks.length < RUN_TICKS) {
        const before = ticks.length;
        session.driver.advance(0, onTick);
        expect(ticks.length - before).toBeLessThanOrEqual(frame);
        await settle(TURN_MS);
      }
      await run;
      expect(ticks).toEqual(Array.from({ length: RUN_TICKS }, (_, i) => start + 1 + i));
      expect(session.host.tick).toBe(start + RUN_TICKS);
    } finally {
      session.dispose();
    }
  });

  it('steps nothing before the first frame', async () => {
    const { session: started } = inProcessSession({ kind: 'scene', id: 'sandbox' }, SPEED, false);
    const session = await started;
    try {
      await settle(TURN_MS);
      expect((await session.host.hashState()).tick).toBe(session.host.tick);
    } finally {
      session.dispose();
    }
  });

  it('holds the clock once the runtime has left its limit of ticks undelivered', async () => {
    const FAST = 16;
    const { session: started } = inProcessSession({ kind: 'scene', id: 'sandbox' }, FAST, false);
    const session = await started;
    try {
      // One frame starts the clock; nothing is delivered after it, so past the limit the worker stops
      // stepping instead of banking ticks.
      session.driver.advance(0);
      const lead = async () => (await session.host.hashState()).tick - session.host.tick;
      const deadline = performance.now() + REACH_LIMIT_TIMEOUT_MS;
      while ((await lead()) < undeliveredTickLimit(FAST)) {
        if (performance.now() > deadline) throw new Error('the worker did not reach its limit');
        await settle(TURN_MS);
      }
      await settle(UNDELIVERED_LIMIT_SECONDS * MS_PER_SECOND * PAST_THE_LIMIT);
      // Checked between the timer's steps, so the last of them may carry it a step or few past.
      expect(await lead()).toBeLessThan(undeliveredTickLimit(FAST) + session.driver.maxStepsPerFrame);
    } finally {
      session.dispose();
    }
  });
});
