import { FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { realMapWorld } from '../test/content/real-map-world.js';
import { intEnv, stringEnv } from './knobs.js';
import { measureWindows } from './measure.js';
import type { BenchWindow } from './report/index.js';
import { publishReport, reportFrom } from './run.js';

/**
 * The sim's per-system benchmark on a REAL decoded map - `npm run bench:map`. It profiles the session
 * `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` headless, over enough ticks for the AI
 * to build a settlement, and reports how each system's cost grows as it does. `npm run bench:sim`
 * measures a synthetic world with isolated axes; this one measures the world the game is actually
 * played on, with its scenery, resource nodes and six competing AI seats.
 *
 * Needs generated content. `scripts/bench-map.mjs` hard-fails without it rather than skipping, so a
 * run that measured nothing cannot be mistaken for a clean one.
 *
 * Knobs (env, all optional): `ON_BENCH_MAP`, `ON_BENCH_SEATS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`,
 * `ON_BENCH_WINDOWS`, `ON_BENCH_JSON=<path>` (write the machine-readable report).
 */

const DEFAULT_MAP_ID = 'magiczny_las';
/** Every seat under AI, matching the `?ai=0,1,2,3,4,5` session the real-content scenarios also use. */
const DEFAULT_AI_SEATS = 6;
/** Far enough in for the AI to leave its opening build order and start straining the systems that
 *  scale with settlement size. `ON_BENCH_TICKS=50000` covers a full build-out. */
const DEFAULT_MEASURED_TICKS = 20_000;
/** The opening ticks are atypical (crews bind, routes are cold) and JIT tiering has not settled. */
const DEFAULT_WARMUP_TICKS = 200;
/** Enough segments to read a curve without turning the table into a log. */
const DEFAULT_WINDOWS = 10;

/** A real-map run reaches into hours at the default tick count. */
const MAP_BENCH_TIMEOUT_MS = 3 * 60 * 60_000;

function progressLine(window: BenchWindow, total: number): string {
  return (
    `window ${window.index + 1}/${total}  ticks ${window.fromTick}..${window.toTick}  ` +
    `median ${window.tickMs.medianMs.toFixed(3)} ms  ` +
    `settlers ${window.population.settlers}  buildings ${window.population.buildings}`
  );
}

describe('map per-system benchmark', () => {
  it('reports how per-system cost grows as the settlement develops', {
    timeout: MAP_BENCH_TIMEOUT_MS,
  }, async () => {
    const mapId = stringEnv('ON_BENCH_MAP', DEFAULT_MAP_ID);
    const seats = intEnv('ON_BENCH_SEATS', DEFAULT_AI_SEATS, 0);
    const warmupTicks = intEnv('ON_BENCH_WARMUP', DEFAULT_WARMUP_TICKS, 0);
    const measuredTicks = intEnv('ON_BENCH_TICKS', DEFAULT_MEASURED_TICKS, 1);
    const windows = intEnv('ON_BENCH_WINDOWS', DEFAULT_WINDOWS, 1);

    const startedAtMs = Date.now();
    const startMs = performance.now();
    const { sim, mapCells } = await realMapWorld({
      mapId,
      aiSeats: [...Array(seats).keys()],
      fog: FOG_MODE.REVEAL,
      berryBushes: true,
    });

    const measurement = measureWindows(sim, {
      warmupTicks,
      measuredTicks,
      windows,
      // A multi-hour run must report progress rather than go silent for an hour.
      onWindow: (window) => console.log(progressLine(window, windows)),
    });

    const report = reportFrom({
      measurement,
      world: {
        kind: 'realMap',
        mapId,
        aiSeats: seats,
        mapCells,
        settlersAtStart: measurement.settlersAtStart,
        settlersAtEnd: measurement.settlersAtEnd,
        buildings: measurement.buildings,
      },
      knobs: {
        ON_BENCH_MAP: mapId,
        ON_BENCH_SEATS: `${seats}`,
        ON_BENCH_TICKS: `${measuredTicks}`,
        ON_BENCH_WARMUP: `${warmupTicks}`,
        ON_BENCH_WINDOWS: `${windows}`,
      },
      ticks: { warmup: warmupTicks, measured: measuredTicks },
      stateHash: sim.hashState(),
      startedAtMs,
      wallSeconds: (performance.now() - startMs) / 1000,
    });

    publishReport(report);

    // The run must have profiled a populated map with work to do. Whether the settlement GREW is
    // reported in the window table rather than asserted: that depends on the tick count, so an
    // assertion would fail an honest short diagnostic run instead of catching a broken world.
    expect(report.systems.length).toBeGreaterThan(0);
    expect(report.world.settlersAtStart).toBeGreaterThan(0);
    expect(report.windows.at(-1)?.population.resourceNodes ?? 0).toBeGreaterThan(0);
  });
});
