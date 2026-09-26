import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import {
  adminCommand,
  type CommandEnvelope,
  exportSaveGame,
  parseCommandLog,
  type Simulation,
  stepReplaying,
  type WorldSnapshot,
} from '@open-northland/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { TICK_BATCHES_IN_FLIGHT, undeliveredTickLimit } from '../src/session/worker/serve.js';
import {
  bundleTestWorker,
  pumpUntil,
  pumpWhile,
  startTestSession,
} from './support/session-worker/start-worker.js';
import { INJECTED_FAULT_MESSAGE } from './support/session-worker/test-world.js';

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
/** The injected fault's tick past the scene's first. */
const FAULT_AFTER_TICKS = 5;
const HEARTBEAT_MS = 50;
const STALL_TIMEOUT_MS = 400;
/** Well past the stall timeout, so the report lands while the worker is still blocked. */
const BLOCK_MS = 1500;
const RESTORE_AT_TICKS = 40;
const SUBMISSIONS = 6;
/** Long enough at the fast speed for the worker to step well past the batches in flight. */
const UNDRAWN_MS = 400;
/** Frames between two submissions, so they land at scattered worker ticks. */
const SUBMIT_EVERY_FRAMES = 7;
const AFTER_RESTORE_TICKS = 20;
const WORKER_BUNDLE_TIMEOUT_MS = 60_000;

function scene(id: string) {
  const found = SCENES.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no '${id}' scene in the registry`);
  return found;
}

/** Component records in name order: the mirror appends a component an entity gains, the sim does not. */
function canonicalEntities(snapshot: WorldSnapshot): string {
  return JSON.stringify(
    snapshot.entities.map((entity) => ({
      id: entity.id,
      components: Object.fromEntries(
        Object.entries(entity.components).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    })),
  );
}

function needsToggle(enabled: boolean): CommandEnvelope {
  return adminCommand({ kind: 'setNeedsEnabled', enabled });
}

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
      // The worker leads the drawn tick by at most its undelivered limit, so past it the last
      // command has applied.
      const lastApplied = (submittedAt.at(-1) ?? 0) + undeliveredTickLimit(FAST_SPEED) + 1;
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
      // One frame starts the clock, then nothing is drawn for a while: the in-flight bound fills and
      // later ticks ride one spanning batch.
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
    // The batches in flight carry a tick each; the one posted once they are delivered spans the rest.
    expect(mostInOneFrame).toBeGreaterThan(TICK_BATCHES_IN_FLIGHT);
  });

  it('posts the seat fog masks as their generation changes, and the next seat on request', async () => {
    const session = await startTestSession(
      bundle.path,
      { kind: 'scene', id: 'team-vision' },
      { speed: FAST_SPEED, paused: false, fogSeat: HUMAN_PLAYER },
    );
    try {
      const generations = new Set<number>();
      const start = session.host.tick;
      await pumpUntil(session, () => {
        const view = session.host.fogView(HUMAN_PLAYER);
        if (view !== null) generations.add(view.generation);
        return session.host.tick >= start + LOOP_TICKS;
      });
      session.driver.setPaused(true);
      await pumpWhile(session, session.host.settled());
      const sim = createSceneSim(scene('team-vision'));
      sim.run(session.host.tick - sim.tick);
      const view = session.host.fogView(HUMAN_PLAYER);
      const live = sim.fogView(HUMAN_PLAYER);
      if (view === null || live === null) throw new Error('the scene plays under fog');
      expect(generations.size).toBeGreaterThan(1);
      expect([view.player, view.generation]).toEqual([HUMAN_PLAYER, live.generation]);
      expect(fogCells(view)).toEqual(fogCells(live));

      session.host.fogView(TEAMMATE);
      await pumpUntil(session, () => session.host.fogView(TEAMMATE)?.player === TEAMMATE);
      const teammate = sim.fogView(TEAMMATE);
      const received = session.host.fogView(TEAMMATE);
      if (teammate === null || received === null) throw new Error('the scene plays under fog');
      expect(fogCells(received)).toEqual(fogCells(teammate));
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
      expect(session.host.tick).toBe(faultTick - 1);
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
});
