import { knobRecord, mapBenchKnobs, mapBenchWorld, worldSourceLine } from './map-world.js';
import { measureWindows } from './measure.js';
import { captureCpuProfile, summarizeProfile } from './profile.js';
import { formatProfile, formatReport } from './report/index.js';
import { reportFrom } from './run.js';
import { benchOutDir, storeCpuProfile } from './store.js';

/**
 * The function-level CPU profile of the same real-map world `npm run bench:map` measures -
 * `npm run bench:profile`. The per-system table says which system got slower; V8's sampler says
 * which function inside it burns the time. Both views cover the same ticks here, so they can be
 * read against each other.
 *
 * Pair it with `ON_BENCH_CHECKPOINT`/`ON_BENCH_SKIP` (see `map-world.ts`) to profile late-game ticks
 * without rebuilding the settlement for every attempt.
 *
 * Two caveats the numbers carry: sampling and the per-system instrument's own clock reads are inside
 * the profile, so absolute times run above an uninstrumented tick; and the report is printed, not
 * stored, so a profiled run can never become a `bench:compare` baseline.
 */

/** Long enough to sample a hotspot, short enough to keep the `.cpuprofile` openable in DevTools. */
const DEFAULT_PROFILED_TICKS = 2_000;
/** The profile covers one segment: the per-system table beside it describes those same ticks. */
const PROFILE_WINDOWS = 1;

async function main(): Promise<void> {
  const knobs = mapBenchKnobs(DEFAULT_PROFILED_TICKS);

  const startedAtMs = Date.now();
  const startMs = performance.now();
  const world = await mapBenchWorld(knobs);
  console.log(worldSourceLine(world, knobs.checkpointPath));

  // Warm up outside the profile: cold-start tiering would otherwise dominate the sample counts.
  for (let i = 0; i < knobs.warmupTicks; i++) world.sim.step();

  const { profile, result: measured } = await captureCpuProfile(() =>
    measureWindows(world.sim, {
      warmupTicks: 0,
      measuredTicks: knobs.measuredTicks,
      windows: PROFILE_WINDOWS,
    }),
  );

  const report = reportFrom({
    measurement: measured,
    world: {
      kind: 'realMap',
      mapId: knobs.mapId,
      aiSeats: knobs.aiSeats,
      mapCells: world.mapCells,
      settlersAtStart: measured.settlersAtStart,
      settlersAtEnd: measured.settlersAtEnd,
      buildings: measured.buildings,
    },
    knobs: knobRecord(knobs),
    ticks: { warmup: knobs.warmupTicks, measured: knobs.measuredTicks },
    stateHash: world.sim.hashState(),
    startedAtMs,
    wallSeconds: (performance.now() - startMs) / 1000,
  });

  const summary = summarizeProfile(profile);
  const written = storeCpuProfile(benchOutDir(), report, profile);
  console.log(`\n${formatProfile(summary)}\n`);
  console.log(`${formatReport(report)}\n`);
  console.log(`cpu profile written to ${written}`);
  console.log(`state hash: ${report.stateHash}\n`);

  if (summary.functions.length === 0 || summary.sampledMs === 0) {
    throw new Error('the profiler sampled nothing over the measured ticks');
  }
  if (report.systems.length === 0) throw new Error('the measured ticks ran no systems');
}

await main();
