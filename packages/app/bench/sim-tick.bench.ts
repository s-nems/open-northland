import { describe, expect, it } from 'vitest';
import { intEnv } from './knobs.js';
import { measureWindows } from './measure.js';
import type { BenchReport } from './report/index.js';
import { publishReport, reportFrom } from './run.js';
import { type BenchWorldOptions, benchWorld } from './world.js';

/**
 * The sim's per-system benchmark on a synthetic world - `npm run bench:sim`. It measures what golden
 * rule 6 (AGENTS.md) asserts and no test can: that per-tick cost scales with active work, not
 * entities². Content is the clean-room sandbox set, so this benchmark runs on any checkout;
 * `npm run bench:map` measures a real decoded map instead. See docs/TESTING.md for how both fit the
 * pyramid and how they are kept out of `npm test`.
 *
 * Knobs (env, all optional): `ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`,
 * `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`, `ON_BENCH_JSON=<path>` (write the machine-readable report).
 */

/** Defaults: 4 settlements (~290 working settlers, 164 buildings) on a 196x196 map - RTS scale in a
 *  window that finishes in well under a minute. Turn `ON_BENCH_SETTLEMENTS` up for a scaling curve. */
const DEFAULT_SETTLEMENTS = 4;
/**
 * No fighters by default: a battle resolves inside the window (65% casualties by tick 300), so a
 * fighter run's medians blend a crowded regime with a thinned one and drift with combat balance rather
 * than with sim cost. The default is the stationary economy world; `ON_BENCH_FIGHTERS=200` opts into
 * combat profiling, and the report's start/end populations show what the window did.
 */
const DEFAULT_FIGHTERS_PER_SIDE = 0;
const DEFAULT_MEASURED_TICKS = 300;
/** Warmup ticks, excluded from the samples: the settlement's first ticks are atypical (the JobSystem's
 *  adopt pass binds every crew, routes are cold) and JIT tiering has not settled. */
const DEFAULT_WARMUP_TICKS = 60;
/** One window by default: this world is stationary, so its cost has no growth curve to report. */
const DEFAULT_WINDOWS = 1;
/** Ticks the determinism check replays - long enough to reach the steady economy (and, when fighters
 *  are on, the first deaths at ~tick 50, so the check covers combat rather than the approach). */
const DETERMINISM_TICKS = 200;

/** The bench builds and runs whole worlds - far past vitest's 5 s default. */
const BENCH_TIMEOUT_MS = 30 * 60_000;
const DETERMINISM_TIMEOUT_MS = 10 * 60_000;

function worldOptions(): BenchWorldOptions {
  return {
    settlements: intEnv('ON_BENCH_SETTLEMENTS', DEFAULT_SETTLEMENTS, 1),
    fightersPerSide: intEnv('ON_BENCH_FIGHTERS', DEFAULT_FIGHTERS_PER_SIDE, 0),
  };
}

/** Run the world for `warmup + measured` ticks, sampling only the measured window. */
function measure(
  options: BenchWorldOptions,
  warmupTicks: number,
  measuredTicks: number,
  windows: number,
): BenchReport {
  const startedAtMs = Date.now();
  const startMs = performance.now();
  const { sim, terrain } = benchWorld(options);
  const measurement = measureWindows(sim, { warmupTicks, measuredTicks, windows });

  return reportFrom({
    measurement,
    world: {
      kind: 'synthetic',
      settlements: options.settlements,
      fightersPerSide: options.fightersPerSide,
      mapCells: { width: terrain.width, height: terrain.height },
      settlersAtStart: measurement.settlersAtStart,
      settlersAtEnd: measurement.settlersAtEnd,
      buildings: measurement.buildings,
    },
    knobs: {
      ON_BENCH_SETTLEMENTS: `${options.settlements}`,
      ON_BENCH_FIGHTERS: `${options.fightersPerSide}`,
      ON_BENCH_TICKS: `${measuredTicks}`,
      ON_BENCH_WARMUP: `${warmupTicks}`,
      ON_BENCH_WINDOWS: `${windows}`,
    },
    ticks: { warmup: warmupTicks, measured: measuredTicks },
    stateHash: sim.hashState(),
    startedAtMs,
    wallSeconds: (performance.now() - startMs) / 1000,
  });
}

describe('sim per-system benchmark', () => {
  it('reports median/p95 ms per system over the measured window', { timeout: BENCH_TIMEOUT_MS }, () => {
    const options = worldOptions();
    const report = measure(
      options,
      intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0),
      intEnv('ON_BENCH_TICKS', DEFAULT_MEASURED_TICKS, 1),
      intEnv('ON_BENCH_WINDOWS', DEFAULT_WINDOWS, 1),
    );

    publishReport(report);

    // The run must have profiled a real world - a silently empty one would report a table of zeros.
    expect(report.systems.length).toBeGreaterThan(0);
    expect(report.world.settlersAtStart).toBeGreaterThan(0);
  });

  it('measures a deterministic world: two runs of the same options hash identically', {
    timeout: DETERMINISM_TIMEOUT_MS,
  }, () => {
    const options = worldOptions();
    const first = benchWorld(options).sim;
    const second = benchWorld(options).sim;
    first.run(DETERMINISM_TICKS);
    second.run(DETERMINISM_TICKS);
    // Guard against a vacuous pass: two undefineds would also be `toBe`-equal.
    expect(first.hashState()).toEqual(expect.any(String));
    expect(first.hashState()).toBe(second.hashState());
  });
});
