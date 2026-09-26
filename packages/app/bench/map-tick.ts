import { intEnv } from './knobs.js';
import { knobRecord, mapBenchKnobs, mapBenchWorld, worldSourceLines } from './map-world.js';
import { measureWindows } from './measure.js';
import type { BenchWindow } from './report/index.js';
import { publishReport, reportFrom } from './run.js';

/**
 * The sim's per-system benchmark on a REAL decoded map - `npm run bench:map`. It profiles the session
 * `?map=magiczny_las&player=observer&ai=0,1,2,3,4,5&fog=classic` headless (the knobs change map, seats
 * and rules), over enough ticks for the AI to build a settlement, and reports how each system's cost
 * grows as it does. `npm run bench:sim`
 * measures a synthetic world with isolated axes; this one measures the world the game is actually
 * played on, with its scenery, resource nodes and six competing AI seats.
 *
 * Needs generated content. `scripts/bench-map.mjs` hard-fails without it rather than skipping, so a
 * run that measured nothing cannot be mistaken for a clean one.
 *
 * Knobs (env, all optional): `ON_BENCH_MAP`, `ON_BENCH_SEATS` (a count or a comma list),
 * `ON_BENCH_PROGRESSION` and `ON_BENCH_NEEDS` (`on`/`off`), `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`,
 * `ON_BENCH_WINDOWS`, `ON_BENCH_SYNC_DIGEST` (fold the per-tick sync digest, the lockstep session's
 * cost), `ON_BENCH_CHECKPOINT`, `ON_BENCH_SKIP` and `ON_BENCH_CHECKPOINTS` (see `map-world.ts`),
 * `ON_BENCH_JSON=<path>` (write the machine-readable report).
 */

/** Far enough in for the AI to leave its opening build order and start straining the systems that
 *  scale with settlement size. `ON_BENCH_TICKS=50000` covers a full build-out. */
const DEFAULT_MEASURED_TICKS = 20_000;
/** Enough segments to read a curve without turning the table into a log. */
const DEFAULT_WINDOWS = 10;

function progressLine(window: BenchWindow, total: number): string {
  return (
    `window ${window.index + 1}/${total}  ticks ${window.fromTick}..${window.toTick}  ` +
    `median ${window.tickMs.medianMs.toFixed(3)} ms  p99 ${window.tickMs.p99Ms.toFixed(3)} ms  ` +
    `max ${window.tickMs.maxMs.toFixed(3)} ms  gc ${window.gc.ms.toFixed(0)} ms  ` +
    `settlers ${window.population.settlers}  fighters ${window.population.fighters}  ` +
    `buildings ${window.population.buildings}  rss ${window.rssMb} MB`
  );
}

async function main(): Promise<void> {
  const knobs = mapBenchKnobs(DEFAULT_MEASURED_TICKS);
  const windows = intEnv('ON_BENCH_WINDOWS', DEFAULT_WINDOWS, 1);

  const startedAtMs = Date.now();
  const startMs = performance.now();
  const world = await mapBenchWorld(knobs, knobs.warmupTicks + knobs.measuredTicks);
  for (const line of worldSourceLines(world, knobs)) console.log(line);

  const measurement = await measureWindows(world.sim, {
    warmupTicks: knobs.warmupTicks,
    measuredTicks: knobs.measuredTicks,
    windows,
    // A multi-hour run must report progress rather than go silent for an hour.
    onWindow: (window) => console.log(progressLine(window, windows)),
    afterTick: world.afterStep,
  });

  const report = reportFrom({
    measurement,
    world: {
      kind: 'realMap',
      mapId: knobs.mapId,
      aiSeats: world.aiSeats,
      progression: knobs.progression,
      needs: knobs.needs,
      mapCells: world.mapCells,
      settlersAtStart: measurement.settlersAtStart,
      settlersAtEnd: measurement.settlersAtEnd,
      buildings: measurement.buildings,
    },
    knobs: { ...knobRecord(knobs), ON_BENCH_WINDOWS: `${windows}` },
    ticks: { warmup: knobs.warmupTicks, measured: knobs.measuredTicks },
    stateHash: world.sim.hashState(),
    startedAtMs,
    wallSeconds: (performance.now() - startMs) / 1000,
  });

  publishReport(report);

  // The run must have profiled a populated map with work to do. Whether the settlement GREW is
  // reported in the window table rather than checked: that depends on the tick count, so a check
  // would fail an honest short diagnostic run instead of catching a broken world.
  if (report.systems.length === 0) throw new Error('the measured ticks ran no systems');
  if (report.world.settlersAtStart === 0) throw new Error(`${knobs.mapId} started with no settlers`);
  if ((report.windows.at(-1)?.population.resourceNodes ?? 0) === 0) {
    throw new Error(`${knobs.mapId} ended with no resource nodes`);
  }
}

await main();
