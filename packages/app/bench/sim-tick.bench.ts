import { writeFileSync } from 'node:fs';
import { type Component, components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type BenchReport, formatReport, summarize } from './report.js';
import { type BenchWorldOptions, benchWorld } from './world.js';

/**
 * The sim's per-system benchmark — `npm run bench:sim`. It measures what golden rule 6 (AGENTS.md)
 * asserts and no test can: that per-tick cost scales with active work, not entities².
 *
 * It runs the deterministic {@link benchWorld} headless, times every system invocation through
 * `Simulation.setInstrument` (the sim's own seam — the timer lives here, in the app layer, so
 * `performance.now` stays out of `packages/sim/src`), and reports median/p95 ms per system plus the
 * whole-tick cost. See docs/TESTING.md for how it fits the pyramid and how it is kept out of `npm test`.
 *
 * Knobs (env, all optional): `ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`,
 * `ON_BENCH_WARMUP`, `ON_BENCH_JSON=<path>` (write the machine-readable report).
 */

const { Building, Settler } = components;

/** Defaults: 4 settlements (~290 working settlers, 164 buildings) on a 196x196 map — RTS scale in a
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
/** Ticks the determinism check replays — long enough to reach the steady economy (and, when fighters
 *  are on, the first deaths at ~tick 50, so the check covers combat rather than the approach). */
const DETERMINISM_TICKS = 200;

/** The bench builds and runs whole worlds — far past vitest's 5 s default. */
const BENCH_TIMEOUT_MS = 30 * 60_000;
const DETERMINISM_TIMEOUT_MS = 10 * 60_000;

/** An integer env knob of at least `min`, or `fallback` when unset/blank. Throws on a malformed or
 *  out-of-range value rather than silently benchmarking a different world than the caller asked for. */
function intEnv(name: string, fallback: number, min: number): number {
  // Trim first: `Number(' ')` is 0, so a blank-but-not-empty value would pass validation as zero.
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got '${raw}'`);
  }
  return value;
}

function worldOptions(): BenchWorldOptions {
  return {
    settlements: intEnv('ON_BENCH_SETTLEMENTS', DEFAULT_SETTLEMENTS, 1),
    fightersPerSide: intEnv('ON_BENCH_FIGHTERS', DEFAULT_FIGHTERS_PER_SIDE, 0),
  };
}

function count(sim: Simulation, component: Component<unknown>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

/** Run the world for `warmup + measured` ticks, sampling only the measured window. */
function measure(options: BenchWorldOptions, warmup: number, measured: number): BenchReport {
  const { sim, terrain } = benchWorld(options);

  const perSystem = new Map<string, number[]>();
  let sampling = false;
  sim.setInstrument((name, run) => {
    // Timed tight around `run`; the bookkeeping below lands outside the interval.
    const start = performance.now();
    run();
    const elapsed = performance.now() - start;
    if (!sampling) return;
    let samples = perSystem.get(name);
    if (samples === undefined) {
      samples = [];
      perSystem.set(name, samples);
    }
    samples.push(elapsed);
  });

  for (let i = 0; i < warmup; i++) sim.step();
  const settlersAtStart = count(sim, Settler);

  sampling = true;
  const tickSamples: number[] = [];
  for (let i = 0; i < measured; i++) {
    const start = performance.now();
    sim.step();
    tickSamples.push(performance.now() - start);
  }

  return summarize(perSystem, tickSamples, {
    world: {
      settlements: options.settlements,
      fightersPerSide: options.fightersPerSide,
      mapCells: { width: terrain.width, height: terrain.height },
      settlersAtStart,
      settlersAtEnd: count(sim, Settler),
      buildings: count(sim, Building),
    },
    ticks: { warmup, measured },
    stateHash: sim.hashState(),
  });
}

describe('sim per-system benchmark', () => {
  it('reports median/p95 ms per system over the measured window', { timeout: BENCH_TIMEOUT_MS }, () => {
    const options = worldOptions();
    const report = measure(
      options,
      intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0),
      intEnv('ON_BENCH_TICKS', DEFAULT_MEASURED_TICKS, 1),
    );

    console.log(`\n${formatReport(report)}\n`);
    const jsonPath = process.env.ON_BENCH_JSON?.trim();
    if (jsonPath !== undefined && jsonPath !== '') {
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`report written to ${jsonPath}\n`);
    }

    // The run must have profiled a real world — a silently empty one would report a table of zeros.
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
