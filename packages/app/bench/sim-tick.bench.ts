import { writeFileSync } from 'node:fs';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { installSimInstrument } from '../src/diag/perf-marks.js';
import { type BenchReport, formatReport, summarize } from './report.js';
import { type BenchWorldOptions, benchWorld } from './world.js';

/**
 * The sim's per-system benchmark — `npm run bench:sim` (AGENTS.md golden rule 6, "per-tick sim cost
 * scales with active work, never entities²", as a number instead of a feeling).
 *
 * It runs the deterministic {@link benchWorld} headless, times every system invocation through the sim's
 * own instrumentation seam (`Simulation.setInstrument`, reused via the app's {@link installSimInstrument}
 * — so `performance.now` stays out of `packages/sim/src`, which its hygiene scan enforces), and reports
 * median/p95 ms per system plus the whole-tick cost.
 *
 * It is a tool, not a test: `*.bench.ts` never matches the repo's default vitest include, so `npm test`
 * and CI never collect it. `bench/vitest.config.ts` is what makes it runnable.
 *
 * Knobs (env, all optional): `ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`,
 * `ON_BENCH_WARMUP`, `ON_BENCH_JSON=<path>` (write the machine-readable report).
 */

const { Building, Settler } = components;

/** Defaults: 4 settlements (~290 working settlers) + 400 fighters ≈ 690 units on a 196x236 map — RTS
 *  scale in a window that still finishes in under a minute on a laptop. Turn them up for a scaling curve. */
const DEFAULT_SETTLEMENTS = 4;
const DEFAULT_FIGHTERS_PER_SIDE = 200;
const DEFAULT_MEASURED_TICKS = 300;
/** Warmup ticks, excluded from the samples: the settlement's first ticks are atypical (the JobSystem's
 *  adopt pass binds every crew, routes are cold) and JIT tiering has not settled. */
const DEFAULT_WARMUP_TICKS = 60;
/** Ticks the determinism check replays. Short by design — it proves the world is reproducible, which the
 *  first diverging tick already shows; the full measured window would only double the bench's wall time. */
const DETERMINISM_TICKS = 40;

/** The bench builds and runs whole worlds — far past vitest's 5 s default. */
const BENCH_TIMEOUT_MS = 30 * 60_000;
const DETERMINISM_TIMEOUT_MS = 5 * 60_000;

/** A positive integer env knob, or `fallback` when unset/blank. Throws on a malformed value rather than
 *  silently benchmarking a different world than the caller asked for. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer, got '${raw}'`);
  return value;
}

function worldOptions(): BenchWorldOptions {
  return {
    settlements: Math.max(1, intEnv('ON_BENCH_SETTLEMENTS', DEFAULT_SETTLEMENTS)),
    fightersPerSide: intEnv('ON_BENCH_FIGHTERS', DEFAULT_FIGHTERS_PER_SIDE),
  };
}

function count(
  sim: ReturnType<typeof benchWorld>['sim'],
  component: Parameters<typeof sim.world.query>[0],
): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

/** Run the world for `warmup + measured` ticks, sampling only the measured window. */
function measure(options: BenchWorldOptions, warmup: number, measured: number): BenchReport {
  const { sim, terrain } = benchWorld(options);

  const perSystem = new Map<string, number[]>();
  let sampling = false;
  installSimInstrument(sim, (name, startMs, endMs) => {
    if (!sampling) return;
    // `installSimInstrument` prefixes the schedule's system name with `sim/` for the DevTools timeline;
    // the report's rows are the bare SYSTEM_ORDER names.
    const key = name.startsWith('sim/') ? name.slice('sim/'.length) : name;
    let samples = perSystem.get(key);
    if (samples === undefined) {
      samples = [];
      perSystem.set(key, samples);
    }
    samples.push(endMs - startMs);
  });

  for (let i = 0; i < warmup; i++) sim.step();

  // Counted at the start of the measured window, so the reported world is the one actually profiled:
  // the armies take casualties as the window runs, so an end-of-run count would understate it.
  const world = {
    settlements: options.settlements,
    fightersPerSide: options.fightersPerSide,
    mapCells: { width: terrain.width, height: terrain.height },
    settlers: count(sim, Settler),
    buildings: count(sim, Building),
  };

  sampling = true;
  const tickSamples: number[] = [];
  for (let i = 0; i < measured; i++) {
    const start = performance.now();
    sim.step();
    tickSamples.push(performance.now() - start);
  }

  return summarize(perSystem, tickSamples, {
    world,
    ticks: { warmup, measured },
    stateHash: sim.hashState(),
  });
}

describe('sim per-system benchmark', () => {
  it('reports median/p95 ms per system over the measured window', { timeout: BENCH_TIMEOUT_MS }, () => {
    const options = worldOptions();
    const report = measure(
      options,
      intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS),
      Math.max(1, intEnv('ON_BENCH_TICKS', DEFAULT_MEASURED_TICKS)),
    );

    console.log(`\n${formatReport(report)}\n`);
    const jsonPath = process.env.ON_BENCH_JSON;
    if (jsonPath !== undefined && jsonPath !== '') {
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`report written to ${jsonPath}\n`);
    }

    // The run must have profiled a real world — a silently empty one would report a table of zeros.
    expect(report.systems.length).toBeGreaterThan(0);
    expect(report.world.settlers).toBeGreaterThan(0);
  });

  it('measures a deterministic world: two runs of the same options hash identically', {
    timeout: DETERMINISM_TIMEOUT_MS,
  }, () => {
    const options = worldOptions();
    const hashes = [0, 1].map(() => {
      const { sim } = benchWorld(options);
      sim.run(DETERMINISM_TICKS);
      return sim.hashState();
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});
