import { MessageChannel } from 'node:worker_threads';
import { MS_PER_TICK } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { changedFacts, readWorldFacts } from '../src/session/worker/facts.js';
import type { SessionPort } from '../src/session/worker/port.js';
import type { FromWorker, ToWorker } from '../src/session/worker/protocol.js';
import { ArrivalAlpha } from '../src/session/worker/render-alpha.js';
import {
  ASSUMED_FRAME_MS,
  BROKEN_SESSION_MESSAGE,
  leadTickLimit,
  serveSession,
} from '../src/session/worker/serve.js';
import { StallWatch } from '../src/session/worker/stall-watch.js';
import { startWorkerSession } from '../src/session/worker/worker-session.js';
import { canonicalEntities } from './support/session-worker/canonical-entities.js';
import { nodeParentPort } from './support/session-worker/node-ports.js';
import { DEFAULT_TEST_OPTIONS, SILENT_STALL_REPORTS } from './support/session-worker/start-worker.js';
import {
  buildTestWorld,
  INJECTED_FAULT_MESSAGE,
  type TestWorldBoot,
} from './support/session-worker/test-world.js';

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

  it('draws a tick that lands while paused whole, and holds it until the next lands', () => {
    const alpha = new ArrivalAlpha(SPEED, false);
    alpha.arrived(0);
    alpha.setPaused(true, PERIOD_MS * HALF);
    alpha.arrived(PERIOD_MS * 2);
    expect(alpha.at(PERIOD_MS * 3)).toBe(1);
    alpha.setPaused(false, PERIOD_MS * 4);
    expect(alpha.at(PERIOD_MS * 10)).toBe(1);
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

function sandbox() {
  const scene = SCENES.find((s) => s.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  return scene;
}

describe('world facts', () => {
  it('posts only what changed, the plots by identity', () => {
    const sim = createSceneSim(sandbox());
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
  const failedTicks: number[] = [];
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
        if (landed.kind === 'tickError') failedTicks.push(landed.tick);
        receive(message, receiveMs);
      }),
  };
  const session = startWorkerSession<TestWorldBoot, null>(
    port,
    boot,
    { ...DEFAULT_TEST_OPTIONS, speed, paused },
    SILENT_STALL_REPORTS,
  );
  return { session, batches, failedTicks };
}

/** How long past reaching its limit the hold test watches the worker. */
const PAST_THE_LIMIT_MS = 500;
/** How long the hold test waits for the worker to reach its limit on a loaded machine. */
const REACH_LIMIT_TIMEOUT_MS = 30_000;
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** A polling interval while the other end of an in-process channel works. */
const TURN_MS = 10;

describe('lead tick limit', () => {
  it('leaves the batch in flight a tick to step behind it at x1 on fast displays', () => {
    for (const frameMs of [ASSUMED_FRAME_MS, 1000 / 120, 1000 / 144]) {
      expect(leadTickLimit(1, frameMs)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('tick batch queue', () => {
  it('keeps one batch in flight and posts every tick stepped meanwhile as one spanning batch', async () => {
    const { session: started, batches } = inProcessSession({ kind: 'scene', id: 'sandbox' });
    const session = await started;
    try {
      const RUN_TICKS = 12;
      const start = session.host.tick;
      const run = session.host.run(RUN_TICKS);
      // The worker answers between the run's slices, so its tick shows how far the run got.
      while ((await session.host.hashState()).tick < start + RUN_TICKS) await settle(TURN_MS);
      expect(batches).toEqual([1]);

      const ticks: number[] = [];
      const onTick = () => ticks.push(session.host.tick);
      // Delivering the first batch releases the rest as one, which the next frame delivers whole.
      session.driver.advance(0, onTick);
      while (batches.length < 2) await settle(TURN_MS);
      expect(batches).toEqual([1, RUN_TICKS - 1]);
      session.driver.advance(0, onTick);
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

  it('holds the clock once the runtime has left its lead of ticks undelivered', async () => {
    const FAST = 16;
    const { session: started } = inProcessSession({ kind: 'scene', id: 'sandbox' }, FAST, false);
    const session = await started;
    try {
      // One frame starts the clock; nothing is delivered after it, so at its lead the worker stops
      // stepping instead of banking ticks. No delivery has reported a frame interval yet.
      session.driver.advance(0);
      const limit = leadTickLimit(FAST, ASSUMED_FRAME_MS);
      const lead = async () => (await session.host.hashState()).tick - session.host.tick;
      const deadline = performance.now() + REACH_LIMIT_TIMEOUT_MS;
      while ((await lead()) < limit) {
        if (performance.now() > deadline) throw new Error('the worker did not reach its limit');
        await settle(TURN_MS);
      }
      await settle(PAST_THE_LIMIT_MS);
      // The clock feeds the driver a tick at a time, so it stops exactly at the limit.
      expect(await lead()).toBe(limit);
    } finally {
      session.dispose();
    }
  });
});

describe('failures between the ends', () => {
  it('keeps a failing tick and the ticks no batch carried yet out of the drawn world', async () => {
    // Past the first tick, which posts at once, so the ticks between it and the fault are pending.
    const FAULT_AFTER_TICKS = 5;
    const direct = createSceneSim(sandbox());
    const faultTick = direct.tick + FAULT_AFTER_TICKS;
    const { session: started, failedTicks } = inProcessSession({
      kind: 'scene',
      id: 'sandbox',
      fault: { tick: faultTick, kind: 'throwAfterWrites' },
    });
    const session = await started;
    try {
      await expect(session.host.run(FAULT_AFTER_TICKS)).rejects.toThrow(INJECTED_FAULT_MESSAGE);
      while (failedTicks.length === 0) await settle(TURN_MS);
      expect(failedTicks).toEqual([faultTick]);
      expect(() => session.driver.advance(0)).toThrow(INJECTED_FAULT_MESSAGE);
      expect(session.host.tick).toBeLessThan(faultTick);
      direct.run(session.host.tick - direct.tick);
      expect(canonicalEntities(session.host.snapshot())).toBe(canonicalEntities(direct.snapshot()));
      // No tick is delivered after the failure, so a wait for one would never end.
      await expect(session.host.run(1)).rejects.toThrow(INJECTED_FAULT_MESSAGE);
      await expect(session.host.settled()).rejects.toThrow(INJECTED_FAULT_MESSAGE);
      // A crash report still reads the world as it stopped.
      await expect(session.host.commandLog()).resolves.toBeDefined();
    } finally {
      session.dispose();
    }
  });

  const CALL_ID = 7;
  const UNCLONEABLE = 'the answer could not be cloned';
  const WORKER_GONE = 'the worker is gone';
  const HEARTBEAT_MS = 10;
  /** Heartbeats a stopped heartbeat would have sent while the test watches. */
  const HEARTBEATS_WATCHED = 5;
  const UNMEASURED_MS = 0;

  it('steps and saves no further a world whose tick threw', async () => {
    const replies = new Map<number, FromWorker<null>>();
    let deliver: (message: ToWorker<TestWorldBoot>) => void = () => undefined;
    const port: SessionPort = {
      post: (message) => {
        const posted = message as FromWorker<null>;
        if (posted.kind === 'reply') replies.set(posted.id, posted);
      },
      listen: (receive) => {
        deliver = (message) => receive(message, UNMEASURED_MS);
      },
      listenFailure: () => undefined,
      close: () => undefined,
    };
    const answer = async (id: number): Promise<FromWorker<null>> => {
      while (!replies.has(id)) await settle(TURN_MS);
      const reply = replies.get(id);
      if (reply === undefined) throw new Error(`no reply ${id}`);
      return reply;
    };
    serveSession(port, buildTestWorld);
    const faultTick = createSceneSim(sandbox()).tick + 1;
    deliver({
      kind: 'boot',
      boot: { kind: 'scene', id: 'sandbox', fault: { tick: faultTick, kind: 'throwAfterWrites' } },
      options: DEFAULT_TEST_OPTIONS,
    });
    deliver({ kind: 'call', id: 1, call: { method: 'run', ticks: 1 } });
    expect(await answer(1)).toMatchObject({ ok: false, error: { message: INJECTED_FAULT_MESSAGE } });
    deliver({ kind: 'call', id: 2, call: { method: 'run', ticks: 1 } });
    expect(await answer(2)).toMatchObject({ ok: false, error: { message: BROKEN_SESSION_MESSAGE } });
    deliver({ kind: 'call', id: 3, call: { method: 'hashState' } });
    expect(await answer(3)).toMatchObject({ ok: true, value: { tick: faultTick } });
    deliver({ kind: 'call', id: 4, call: { method: 'captureSave', options: {} } });
    expect(await answer(4)).toMatchObject({ ok: false, error: { message: BROKEN_SESSION_MESSAGE } });
  });

  it('replies with an error when the answer itself cannot be posted', async () => {
    const replies: FromWorker<null>[] = [];
    let refuseReply = true;
    let deliver: (message: ToWorker<TestWorldBoot>) => void = () => undefined;
    const port: SessionPort = {
      post: (message) => {
        const posted = message as FromWorker<null>;
        if (posted.kind !== 'reply') return;
        if (refuseReply) {
          refuseReply = false;
          throw new Error(UNCLONEABLE);
        }
        replies.push(posted);
      },
      listen: (receive) => {
        deliver = (message) => receive(message, UNMEASURED_MS);
      },
      listenFailure: () => undefined,
      close: () => undefined,
    };
    serveSession(port, buildTestWorld);
    deliver({ kind: 'boot', boot: { kind: 'scene', id: 'sandbox' }, options: DEFAULT_TEST_OPTIONS });
    deliver({ kind: 'call', id: CALL_ID, call: { method: 'hashState' } });
    while (replies.length === 0) await settle(TURN_MS);
    expect(replies).toMatchObject([
      { kind: 'reply', id: CALL_ID, ok: false, error: { message: UNCLONEABLE } },
    ]);
  });

  it('rejects the pending asks and stops its heartbeat when the worker fails', async () => {
    const channel = new MessageChannel();
    serveSession(nodeParentPort(channel.port1), buildTestWorld);
    const inner = nodeParentPort(channel.port2);
    let failWorker: (error: Error) => void = () => undefined;
    let pings = 0;
    const port: SessionPort = {
      listen: inner.listen,
      post: (message, transfer) => {
        if ((message as ToWorker<unknown>).kind === 'ping') pings++;
        inner.post(message, transfer);
      },
      listenFailure: (fail) => {
        failWorker = fail;
      },
      close: () => {
        channel.port1.close();
        channel.port2.close();
      },
    };
    const session = await startWorkerSession<TestWorldBoot, null>(
      port,
      { kind: 'scene', id: 'sandbox' },
      DEFAULT_TEST_OPTIONS,
      SILENT_STALL_REPORTS,
      { heartbeatMs: HEARTBEAT_MS },
    );
    try {
      const pending = session.host.hashState();
      failWorker(new Error(WORKER_GONE));
      await expect(pending).rejects.toThrow(WORKER_GONE);
      const pingsAtFailure = pings;
      await settle(HEARTBEAT_MS * HEARTBEATS_WATCHED);
      expect(pings).toBe(pingsAtFailure);
    } finally {
      session.dispose();
    }
  });
});
