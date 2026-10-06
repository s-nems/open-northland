import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import {
  adminCommand,
  type CommandEnvelope,
  components,
  type Entity,
  exportSaveGame,
  parseCommandLog,
  playerCommand,
  type Simulation,
  stepReplaying,
} from '@open-northland/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diagCadenceAt, HASH_TRACE_EVERY_TICKS } from '../src/diag/session.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { IDLE_WORK_NAMES, idleWorkScene, idleWorkWorker } from '../src/scenes/idle-work.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import type { SessionHost } from '../src/session/host.js';
import { inlineSessionHost } from '../src/session/inline-host.js';
import type { FromWorker, ToWorker, WorkerSessionOptions } from '../src/session/worker/protocol.js';
import { ASSUMED_FRAME_MS, leadTickLimit, REPLACED_SESSION_MESSAGE } from '../src/session/worker/serve.js';
import { sessionOverPort, type WorkerSessionOpening } from '../src/session/worker/worker-session.js';
import { canonicalEntities } from './support/session-worker/canonical-entities.js';
import {
  bundleTestWorker,
  DEFAULT_TEST_OPTIONS,
  pumpUntil,
  pumpWhile,
  SILENT_STALL_REPORTS,
  startTestSession,
  testWorkerPort,
} from './support/session-worker/start-worker.js';
import { INJECTED_FAULT_MESSAGE, type TestWorldBoot } from './support/session-worker/test-world.js';

/**
 * The worker host under Node's `worker_threads`: the same world, run in the worker and inline, reaches
 * the same state, and the runtime's side sees every tick the worker stepped.
 */

/** The scenes the loopback parity test runs, reaching distinct system sets. */
const PARITY_SCENES = ['battle', 'construction', 'sandbox', 'tower-defence'];
const PARITY_TICKS = 120;
/** Fast enough that the clock-driven tests take a fraction of a second per hundred ticks. */
const FAST_SPEED = 8;
const LOOP_TICKS = 60;
const TEAMMATE = 1;
/** Where the human seat's soldier walks in the fog test: east into ground it has not seen. */
const WALK_EAST_TO = { x: 20, y: 6 } as const;
const WALK_TICKS = 120;
/** The injected fault's tick past the scene's first. */
const FAULT_AFTER_TICKS = 5;
const HEARTBEAT_MS = 50;
const STALL_TIMEOUT_MS = 400;
/** Well past the stall timeout, so the report lands while the worker is still blocked. */
const BLOCK_MS = 1500;
const RESTORE_AT_TICKS = 40;
const SUBMISSIONS = 6;
/** Several of the run's slices, so a command lands while it yields. */
const RUN_WITH_ORDER_TICKS = 60;
const MISSING_WORKER = '/nonexistent/session-worker.mjs';
/** Long enough at the fast speed for the worker to step well past the batches in flight. */
const UNDRAWN_MS = 400;
/** Frames between two submissions, so they land at scattered worker ticks. */
const SUBMIT_EVERY_FRAMES = 7;
const AFTER_RESTORE_TICKS = 20;
const WORKER_BUNDLE_TIMEOUT_MS = 60_000;
/** A run the replacing boot lands in the middle of. */
const LONG_RUN_TICKS = 100_000;
/** How long the replaced session is watched for posts. */
const QUIET_MS = 300;

function scene(id: string) {
  const found = SCENES.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no '${id}' scene in the registry`);
  return found;
}

function needsToggle(enabled: boolean): CommandEnvelope {
  return adminCommand({ kind: 'setNeedsEnabled', enabled });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fogCells(view: { stateAt(x: number, y: number): number; cellsWide: number; cellsHigh: number }) {
  const cells: number[] = [];
  for (let y = 0; y < view.cellsHigh; y++)
    for (let x = 0; x < view.cellsWide; x++) cells.push(view.stateAt(x, y));
  return cells;
}

describe('session worker host', () => {
  let bundle: Awaited<ReturnType<typeof bundleTestWorker>>;
  beforeAll(async () => {
    bundle = await bundleTestWorker();
  }, WORKER_BUNDLE_TIMEOUT_MS);
  afterAll(() => bundle.dispose());

  for (const id of PARITY_SCENES) {
    it(`reaches the direct loop's state and snapshot on '${id}'`, async () => {
      const session = await startTestSession(bundle.path, { kind: 'scene', id });
      try {
        await pumpWhile(session, session.host.run(PARITY_TICKS));
        const direct = createSceneSim(scene(id));
        direct.run(PARITY_TICKS);
        expect(await session.host.hashState()).toEqual({ tick: direct.tick, hash: direct.hashState() });
        expect(session.host.tick).toBe(direct.tick);
        expect(canonicalEntities(session.host.snapshot())).toBe(canonicalEntities(direct.snapshot()));
      } finally {
        session.dispose();
      }
    });
  }

  it('carries detailed idle reasons over the worker host without changing the simulation', async () => {
    const session = await startTestSession(bundle.path, { kind: 'scene', id: idleWorkScene.id });
    try {
      await pumpWhile(session, session.host.run(idleWorkScene.runTicks));
      const direct = createSceneSim(idleWorkScene);
      direct.run(idleWorkScene.runTicks);
      const before = await session.host.hashState();
      for (const name of Object.values(IDLE_WORK_NAMES)) {
        const worker = idleWorkWorker(direct, name);
        if (worker === undefined) throw new Error(`Missing scene worker ${name}`);
        expect(await session.host.workStatus(worker)).toEqual(direct.workStatus(worker));
      }
      const baker = idleWorkWorker(direct, IDLE_WORK_NAMES.ingredients);
      if (baker === undefined) throw new Error('Missing baker');
      expect(await session.host.workStatus(baker)).toMatchObject({
        kind: 'waitingInput',
        missingInputs: [
          { required: 1, available: 0, missing: 1 },
          { required: 1, available: 0, missing: 1 },
        ],
      });
      expect(await session.host.hashState()).toEqual(before);
    } finally {
      session.dispose();
    }
  });

  it('runs its own clock over the loopback driver as the inline driver runs the same stream', async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'sandbox' },
      { speed: FAST_SPEED },
    );
    try {
      // Submitted while paused, so the worker admits it at the tick after the one it stands at.
      const issuedAt = session.host.tick;
      session.driver.submit(needsToggle(false));
      session.driver.setPaused(false);
      await pumpUntil(session, () => session.host.tick >= issuedAt + LOOP_TICKS);
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      const hashed = await session.host.hashState();
      expect(hashed.tick).toBe(session.host.tick);

      const sim = createSceneSim(scene('sandbox'));
      const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
      while (sim.tick < issuedAt) driver.runTick();
      driver.submit(needsToggle(false));
      while (sim.tick < hashed.tick) driver.runTick();
      expect(sim.hashState()).toBe(hashed.hash);
    } finally {
      session.dispose();
    }
  });

  it('logs a command at the tick the worker admitted it, and the log replays to its hash', async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'sandbox' },
      { speed: FAST_SPEED, paused: false },
    );
    try {
      const submittedAt: number[] = [];
      let frames = 0;
      await pumpUntil(session, () => {
        // Every few frames, wherever the worker happens to be.
        if (++frames % SUBMIT_EVERY_FRAMES === 0) {
          submittedAt.push(session.host.tick);
          session.driver.submit(needsToggle(submittedAt.length % 2 === 0));
        }
        return submittedAt.length >= SUBMISSIONS;
      });
      // The worker leads the drawn tick by at most its lead, so past it the last command has applied.
      // The pump's frames are shorter than the one assumed before the first delivery.
      const lastApplied = (submittedAt.at(-1) ?? 0) + leadTickLimit(FAST_SPEED, ASSUMED_FRAME_MS) + 1;
      await pumpUntil(session, () => session.host.tick > lastApplied);
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      const hashed = await session.host.hashState();
      const log = await session.host.commandLog();
      // The scene's own setup logs the same kind at its first tick, under the setup origin.
      const toggles = log.filter(
        (entry) => entry.origin === 'admin' && entry.command.kind === 'setNeedsEnabled',
      );
      expect(toggles).toHaveLength(submittedAt.length);
      // The worker stood at or past the tick the runtime drew when each command left it.
      toggles.forEach((entry, i) => {
        expect(entry.applyTick).toBeGreaterThan(submittedAt[i] ?? Number.POSITIVE_INFINITY);
        expect(entry.applyTick).toBeLessThanOrEqual(hashed.tick);
      });

      const replayed = createSceneSim(scene('sandbox'));
      replayed.commands.discardPending();
      stepReplaying(replayed, parseCommandLog(JSON.parse(JSON.stringify(log))), hashed.tick);
      expect(replayed.hashState()).toBe(hashed.hash);
    } finally {
      session.dispose();
    }
  });

  it("delivers every tick's events in order when the runtime applies late", async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'battle' },
      { speed: FAST_SPEED, paused: false },
    );
    const delivered: { tick: number; events: string }[] = [];
    let mostInOneFrame = 0;
    try {
      // One frame starts the clock, then nothing is drawn for a while: the worker stops at its lead,
      // and the ticks stepped behind the batch in flight ride one spanning batch.
      session.driver.advance(0);
      await new Promise((resolve) => setTimeout(resolve, UNDRAWN_MS));
      const target = session.host.tick + LOOP_TICKS;
      let before = 0;
      await pumpUntil(
        session,
        () => {
          mostInOneFrame = Math.max(mostInOneFrame, delivered.length - before);
          before = delivered.length;
          return session.host.tick >= target;
        },
        () => delivered.push({ tick: session.host.tick, events: JSON.stringify(session.host.tickEvents()) }),
      );
    } finally {
      session.dispose();
    }
    const first = delivered[0]?.tick ?? 0;
    expect(delivered.map((d) => d.tick)).toEqual(delivered.map((_, i) => first + i));

    const sim: Simulation = createSceneSim(scene('battle'));
    const reference: string[] = [];
    while (sim.tick < first + delivered.length - 1) {
      sim.step();
      if (sim.tick >= first) reference.push(JSON.stringify(sim.events.current()));
    }
    expect(delivered.map((d) => d.events)).toEqual(reference);
    expect(reference.some((events) => events !== '[]')).toBe(true);
    // The backlog behind the first batch is delivered whole by one frame, and it is no more than the
    // lead the worker held at.
    expect(mostInOneFrame).toBeGreaterThan(1);
    expect(mostInOneFrame).toBeLessThanOrEqual(leadTickLimit(FAST_SPEED, ASSUMED_FRAME_MS));
  });

  it('posts the seat fog masks as they change, and the next seat on request', async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'team-vision' },
      { speed: FAST_SPEED, paused: false, fogSeat: HUMAN_PLAYER },
    );
    try {
      // A generation reaches the runtime only with cells the previous one it drew did not show. The world
      // is posted before its setup gives the seat a mask.
      expect(session.host.fogView(HUMAN_PLAYER)).toBeNull();
      const drawnCells: string[] = [];
      let drawnGeneration: number | null = null;
      const draw = (): void => {
        const view = session.host.fogView(HUMAN_PLAYER);
        if (view !== null && view.generation !== drawnGeneration) {
          drawnGeneration = view.generation;
          drawnCells.push(JSON.stringify(fogCells(view)));
        }
      };
      const start = session.host.tick;
      await pumpUntil(session, () => {
        draw();
        return session.host.tick >= start + LOOP_TICKS;
      });
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      const sim = createSceneSim(scene('team-vision'));
      sim.run(session.host.tick - sim.tick);
      const view = session.host.fogView(HUMAN_PLAYER);
      const live = sim.fogView(HUMAN_PLAYER);
      if (view === null || live === null) throw new Error('the scene plays under fog');
      expect(drawnCells.length).toBeGreaterThan(0);
      for (let i = 1; i < drawnCells.length; i++) expect(drawnCells[i]).not.toBe(drawnCells[i - 1]);
      // A generation that left this seat's mask as it was is not posted, so the view may stand at an
      // earlier one with the same cells.
      expect(view.player).toBe(HUMAN_PLAYER);
      expect(view.generation).toBeLessThanOrEqual(live.generation);
      expect(fogCells(view)).toEqual(fogCells(live));

      // Once the next seat's masks are drawn, the previous seat's never are again.
      session.driver.setPaused(false);
      session.host.fogView(TEAMMATE);
      const heldTo = (await session.host.hashState()).tick;
      const seatsDrawn: number[] = [];
      await pumpUntil(session, () => {
        const drawn = session.host.fogView(TEAMMATE)?.player;
        if (drawn !== undefined && (drawn === TEAMMATE || seatsDrawn.length > 0)) seatsDrawn.push(drawn);
        return session.host.tick >= heldTo;
      });
      expect(new Set(seatsDrawn)).toEqual(new Set([TEAMMATE]));
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      sim.run(session.host.tick - sim.tick);
      const teammate = sim.fogView(TEAMMATE);
      const received = session.host.fogView(TEAMMATE);
      if (teammate === null || received === null) throw new Error('the scene plays under fog');
      expect(fogCells(received)).toEqual(fogCells(teammate));

      // The human soldier's walk east reveals ground to the shared mask: a changed mask reaches the
      // runtime after the ones already drawn.
      const before = JSON.stringify(fogCells(received));
      const soldier = session.host
        .snapshot()
        .entities.find(
          (e) => (e.components.Owner as { player?: number } | undefined)?.player === HUMAN_PLAYER,
        );
      if (soldier === undefined) throw new Error('the scene gives the human seat a soldier');
      session.driver.setPaused(false);
      session.driver.submit(
        playerCommand(HUMAN_PLAYER, { kind: 'moveUnit', entity: soldier.id as Entity, ...WALK_EAST_TO }),
      );
      const walkStart = session.host.tick;
      await pumpUntil(session, () => {
        const view = session.host.fogView(TEAMMATE);
        return (
          (view !== null && JSON.stringify(fogCells(view)) !== before) ||
          session.host.tick >= walkStart + WALK_TICKS
        );
      });
      const walked = session.host.fogView(TEAMMATE);
      expect(walked === null ? before : JSON.stringify(fogCells(walked))).not.toBe(before);
    } finally {
      session.dispose();
    }
  });

  it('rethrows a tick error from the driver where the inline step would have thrown', async () => {
    const faultTick = createSceneSim(scene('sandbox')).tick + FAULT_AFTER_TICKS;
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'sandbox', fault: { tick: faultTick, kind: 'throw' } },
      { speed: FAST_SPEED, paused: false },
    );
    try {
      await expect(pumpUntil(session, () => false)).rejects.toThrow(INJECTED_FAULT_MESSAGE);
      expect(session.host.tick).toBeLessThan(faultTick);
    } finally {
      session.dispose();
    }
  });

  it('reports a worker silent past the stall timeout, and its recovery', async () => {
    const reports: string[] = [];
    const faultTick = createSceneSim(scene('sandbox')).tick + FAULT_AFTER_TICKS;
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'sandbox', fault: { tick: faultTick, kind: 'block', blockMs: BLOCK_MS } },
      { speed: FAST_SPEED, paused: false },
      {
        stalled: (silentMs) => reports.push(`stalled ${silentMs >= STALL_TIMEOUT_MS}`),
        recovered: (silentMs) => reports.push(`recovered ${silentMs >= STALL_TIMEOUT_MS}`),
      },
      { heartbeatMs: HEARTBEAT_MS, stallTimeoutMs: STALL_TIMEOUT_MS },
    );
    try {
      await pumpUntil(session, () => reports.length >= 2);
      expect(reports).toEqual(['stalled true', 'recovered true']);
    } finally {
      session.dispose();
    }
  });

  it('restores a save and captures one with the input it accepted', async () => {
    const sim = createSceneSim(scene('construction'));
    sim.run(RESTORE_AT_TICKS);
    const session = await startTestSession(bundle.path, {
      kind: 'scene',
      id: 'construction',
      save: exportSaveGame(sim),
    });
    try {
      expect(await session.host.hashState()).toEqual({ tick: sim.tick, hash: sim.hashState() });
      await pumpWhile(session, session.host.run(AFTER_RESTORE_TICKS));
      sim.run(AFTER_RESTORE_TICKS);
      expect(await session.host.hashState()).toEqual({ tick: sim.tick, hash: sim.hashState() });

      session.driver.submit(needsToggle(false));
      const captured = await session.driver.captureSave();
      expect(captured.header.tick).toBe(sim.tick);
      const commands = captured.sections.find((section) => section.id === 'commands');
      expect(
        commands?.id === 'commands'
          ? commands.continuation.map((c) => [c.applyTick, c.envelope.command.kind])
          : null,
      ).toEqual([[sim.tick + 1, 'setNeedsEnabled']]);
    } finally {
      session.dispose();
    }
  });

  it('rejects the boot of a worker that does not load', async () => {
    await expect(startTestSession(MISSING_WORKER, { kind: 'scene', id: 'sandbox' })).rejects.toThrow();
  });

  it('applies a command submitted while a run yields, at the tick the worker gave it', async () => {
    const session = await startTestSession(bundle.path, { kind: 'scene', id: 'sandbox' });
    try {
      const run = session.host.run(RUN_WITH_ORDER_TICKS);
      // Arrives between the run's slices, which admit it like the clock would.
      session.driver.submit(needsToggle(false));
      await pumpWhile(session, run);
      const log = await session.host.commandLog();
      expect(log.filter((entry) => entry.origin === 'admin')).toHaveLength(1);
      const captured = await session.driver.captureSave();
      const commands = captured.sections.find((section) => section.id === 'commands');
      expect(commands?.id === 'commands' ? commands.continuation : null).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("answers the sim's defaults for a seat outside the facts table", async () => {
    const session = await startTestSession(bundle.path, { kind: 'scene', id: 'sandbox' });
    try {
      const outside = components.MAX_PLAYERS;
      const sim = createSceneSim(scene('sandbox'));
      expect(session.host.diplomacyStance(0, outside)).toBe(sim.diplomacyStance(0, outside));
      expect(session.host.hasMetPlayer(outside, outside)).toBe(sim.hasMetPlayer(outside, outside));
      expect(session.host.hasMetPlayer(0, outside)).toBe(sim.hasMetPlayer(0, outside));
    } finally {
      session.dispose();
    }
  });
  it('replaces the served session when another world boots on the same port', async () => {
    const heard: FromWorker<null>[] = [];
    const port = testWorkerPort(bundle.path, (message) => heard.push(message));
    // The worker answers a boot with its ready or failure; everything else belongs to the session
    // served until then.
    let served: WorkerSessionOpening<null> | null = null;
    let booting: WorkerSessionOpening<null> | null = null;
    port.listen((message, receiveMs) => {
      const landed = message as FromWorker<null>;
      if ((landed.kind === 'ready' || landed.kind === 'bootFailed') && booting !== null) {
        served = booting;
        booting = null;
      }
      served?.receive(landed, receiveMs);
    });
    port.listenFailure((error) => (booting ?? served)?.fail(error));
    const outlet = { post: port.post, close: () => undefined };
    const boot = (world: TestWorldBoot, options: WorkerSessionOptions) => {
      const opening = sessionOverPort<null>(outlet, options, SILENT_STALL_REPORTS);
      booting = opening;
      const message: ToWorker<TestWorldBoot> = { kind: 'boot', boot: world, options };
      opening.postBoot(message);
      return opening.ready;
    };
    try {
      const first = await boot(
        { kind: 'scene', id: 'sandbox' },
        { ...DEFAULT_TEST_OPTIONS, speed: FAST_SPEED, paused: false },
      );
      const start = first.host.tick;
      await pumpUntil(first, () => first.host.tick > start);
      const running = first.host.run(LONG_RUN_TICKS);
      running.catch(() => undefined);

      const second = await boot({ kind: 'scene', id: 'construction' }, DEFAULT_TEST_OPTIONS);
      await expect(running).rejects.toThrow(REPLACED_SESSION_MESSAGE);
      first.dispose();
      const afterReady = heard.length;
      await sleep(QUIET_MS);
      expect(heard.slice(afterReady).filter((message) => message.kind !== 'pong')).toEqual([]);

      const fresh = createSceneSim(scene('construction'));
      expect(await second.host.hashState()).toEqual({ tick: fresh.tick, hash: fresh.hashState() });
      second.dispose();
    } finally {
      port.close();
    }
  });

  it('answers tick diagnostics on the diag cadence alone, inline and in the worker', async () => {
    /** Each delivered tick's answer: whether it was on the cadence, and whether the host answered. */
    const answers = (host: SessionHost, onCadence: boolean[], landed: Promise<boolean>[]) => () => {
      onCadence.push(diagCadenceAt(host.tick) !== null);
      landed.push(
        host.tickDiagnostics().then(
          () => true,
          () => false,
        ),
      );
    };
    const sim = createSceneSim(scene('sandbox'));
    const inline = inlineSessionHost(sim);
    const inlineCadence: boolean[] = [];
    const inlineLanded: Promise<boolean>[] = [];
    const answerInline = answers(inline, inlineCadence, inlineLanded);
    for (let i = 0; i < HASH_TRACE_EVERY_TICKS; i++) {
      sim.step();
      answerInline();
    }
    expect(inlineCadence).toContain(true);
    expect(await Promise.all(inlineLanded)).toEqual(inlineCadence);

    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'sandbox' },
      { speed: FAST_SPEED, paused: false, diagnostics: true },
    );
    try {
      const workerCadence: boolean[] = [];
      const workerLanded: Promise<boolean>[] = [];
      const start = session.host.tick;
      await pumpUntil(
        session,
        () => session.host.tick >= start + HASH_TRACE_EVERY_TICKS,
        answers(session.host, workerCadence, workerLanded),
      );
      expect(workerCadence).toContain(true);
      expect(await Promise.all(workerLanded)).toEqual(workerCadence);
    } finally {
      session.dispose();
    }
  });

  it('rejects `run` on a session that steps only on its clock', async () => {
    const session = await startTestSession(bundle.path, { kind: 'scene', id: 'sandbox', clockOnly: true });
    try {
      await expect(session.host.run(1)).rejects.toThrow('steps only on its clock');
    } finally {
      session.dispose();
    }
  });
});
