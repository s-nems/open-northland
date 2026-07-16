import { HashTrace, stepReplaying } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsBundle,
  DIAGNOSTICS_BUNDLE_KIND,
  DIAGNOSTICS_BUNDLE_VERSION,
  DiagLog,
  type DiagnosticsBundle,
  HASH_TRACE_EVERY_TICKS,
  recordDiagHash,
  serializeDiagnosticsBundle,
  setDiagGameSession,
} from '../src/diag/index.js';
import { createSceneSim, SCENES } from '../src/scenes/index.js';

/**
 * The diagnostics bundle's core promise: a tester's downloaded JSON is a FULL session repro. World
 * setup is pre-tick-0 builder work (scene `build`/map spawns — not commands), so the dev-side
 * procedure the round-trip test pins is: rebuild the world with the same builder (the bundle's
 * `entry` + `worldId` name it), then `stepReplaying` the bundle's command log to the bundle's tick —
 * the state hash must equal the recorded `finalHash`.
 */

const scene = SCENES[0];
if (scene === undefined) throw new Error('no registered scenes — the bundle round-trip needs one');
const RUN_TICKS = 60;

describe('diagnostics bundle', () => {
  it('serializes a live session and replays back to the recorded finalHash', () => {
    const sim = createSceneSim(scene);
    const trace = new HashTrace();
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      // A mid-run player command, so the log carries more than the scene's own setup commands.
      if (tick === RUN_TICKS / 2) sim.enqueue({ kind: 'setNeedsEnabled', enabled: true });
      sim.step();
      if (tick % HASH_TRACE_EVERY_TICKS === 0) trace.record(tick, sim.hashState());
    }

    const log = new DiagLog({ consoleLevel: 'silent', now: () => 7 });
    log.warn('content', 'synthetic pre-crash entry');
    const bundle = buildDiagnosticsBundle(log, {
      entry: 'scene',
      worldId: scene.id,
      seed: scene.seed,
      sim,
      hashTrace: trace,
    });

    // The tester→dev boundary: everything below reads only the parsed JSON text.
    const parsed = JSON.parse(serializeDiagnosticsBundle(bundle)) as DiagnosticsBundle;
    expect(parsed.kind).toBe(DIAGNOSTICS_BUNDLE_KIND);
    expect(parsed.version).toBe(DIAGNOSTICS_BUNDLE_VERSION);
    expect(parsed.log[0]?.message).toBe('synthetic pre-crash entry');
    const game = parsed.game;
    expect(game).not.toBeNull();
    if (game === null) return;
    expect(game.worldId).toBe(scene.id);
    expect(game.tick).toBe(RUN_TICKS);
    expect(game.hashes?.map((h) => h.tick)).toEqual([20, 40, 60]);

    const replayed = createSceneSim(scene);
    // The builder enqueued its setup commands again, but the log already carries them (every applied
    // command is logged) — drop the pending duplicates and let the log supply ALL commands in their
    // original apply order.
    replayed.commands.drain();
    stepReplaying(replayed, game.commandLog, game.tick);
    expect(replayed.hashState()).toBe(game.finalHash);
    expect(replayed.hashState()).toBe(game.hashes?.at(-1)?.hash);
  });

  it('never cuts shared references inside the replay payload', () => {
    const sim = createSceneSim(scene);
    // The same command OBJECT enqueued twice — commands are held by reference in the log, so a
    // naive whole-bundle cycle guard would stringify the second occurrence as "[circular]".
    const shared = { kind: 'setNeedsEnabled', enabled: true } as const;
    sim.enqueue(shared);
    sim.step();
    sim.enqueue(shared);
    sim.step();
    const log = new DiagLog({ consoleLevel: 'silent', now: () => 1 });
    const bundle = buildDiagnosticsBundle(log, {
      entry: 'scene',
      worldId: scene.id,
      seed: scene.seed,
      sim,
      hashTrace: null,
    });
    const parsed = JSON.parse(serializeDiagnosticsBundle(bundle)) as DiagnosticsBundle;
    const needsCommands = parsed.game?.commandLog.filter((c) => c.command.kind === 'setNeedsEnabled');
    expect(needsCommands?.length).toBeGreaterThanOrEqual(2);
    // Log data stays defensively sanitized: a true cycle becomes "[circular]" instead of throwing.
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    log.warn('content', 'cyclic payload', cyclic);
    const reserialized = JSON.parse(
      serializeDiagnosticsBundle(buildDiagnosticsBundle(log, null)),
    ) as DiagnosticsBundle;
    expect(reserialized.log[0]?.data).toEqual({ self: '[circular]' });
  });

  it('degrades to a log-only bundle when no game session is registered', () => {
    const log = new DiagLog({ consoleLevel: 'silent', now: () => 1 });
    log.error('crash', 'boot failure');
    const parsed = JSON.parse(
      serializeDiagnosticsBundle(buildDiagnosticsBundle(log, null)),
    ) as DiagnosticsBundle;
    expect(parsed.game).toBeNull();
    expect(parsed.log).toHaveLength(1);
  });

  it('records hashes through the session on the fixed cadence, only for the registered sim', () => {
    const sim = createSceneSim(scene);
    const other = createSceneSim(scene);
    const trace = new HashTrace();
    setDiagGameSession({ entry: 'scene', worldId: scene.id, seed: scene.seed, sim, hashTrace: trace });
    try {
      for (let tick = 1; tick <= HASH_TRACE_EVERY_TICKS; tick++) {
        sim.step();
        recordDiagHash(sim);
        other.step();
        recordDiagHash(other); // an unregistered sim must never taint the trace
      }
    } finally {
      setDiagGameSession(null);
    }
    expect(trace.list().map((e) => e.tick)).toEqual([HASH_TRACE_EVERY_TICKS]);
    expect(trace.hashAt(HASH_TRACE_EVERY_TICKS)).toBe(sim.hashState());
  });
});
