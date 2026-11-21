// First, so the sim it is evaluated before reads the switch.
import './sim-asserts.js';
import { intEnv, stringEnv } from './knobs.js';
import { knobRecord, mapBenchKnobs, mapBenchWorld, worldSourceLines } from './map-world.js';
import { marchKnobRecord, marchKnobs, marchProbe } from './march-order.js';
import { measureWindows } from './measure.js';
import {
  type CpuCapture,
  captureAllocationProfile,
  captureCpuProfile,
  DEFAULT_ALLOCATION_SAMPLING_INTERVAL_BYTES,
  type ProfileSummary,
  summarizeAllocations,
  summarizeProfile,
} from './profile.js';
import { formatProfile, formatReport, formatSpikes } from './report/index.js';
import { reportFrom } from './run.js';
import { busiestTickSpans, tickSpikes } from './spike-profile.js';
import { benchOutDir, type ProfileKind, storeProfile } from './store.js';

/**
 * The function-level CPU profile of the same real-map world `npm run bench:map` measures -
 * `npm run bench:profile`. The per-system table says which system got slower; V8's sampler says
 * which function inside it burns the time. Both views cover the same ticks here, so they can be
 * read against each other. `ON_BENCH_PROFILE=alloc` samples allocations instead of CPU: which
 * function makes the garbage the window's GC columns pay for. CPU mode also breaks the
 * `ON_BENCH_SPIKE_TICKS` longest-running ticks down by function (see `spike-profile.ts`).
 *
 * The `ON_BENCH_MARCH_*` knobs (see `march-order.ts`) profile a group attack-move; start the profile
 * at the order with `ON_BENCH_WARMUP` so the march fills the sampled ticks.
 *
 * Pair it with `ON_BENCH_CHECKPOINT`/`ON_BENCH_SKIP` (see `map-world.ts`) to profile late-game ticks
 * without rebuilding the settlement for every attempt; `ON_BENCH_CHECKPOINT` may name a mark file a
 * `bench:map` run wrote. It takes no `ON_BENCH_CHECKPOINTS`: a checkpoint written inside the profiled
 * ticks would be profiled with them.
 *
 * Two caveats the numbers carry: sampling and the per-system instrument's own clock reads are inside
 * the profile, so absolute times run above an uninstrumented tick; and the report is printed, not
 * stored, so a profiled run can never become a `bench:compare` baseline.
 */

/** Long enough to sample a hotspot, short enough to keep the `.cpuprofile` openable in DevTools. */
const DEFAULT_PROFILED_TICKS = 2_000;
/** The profile covers one segment: the per-system table beside it describes those same ticks. */
const PROFILE_WINDOWS = 1;
const DEFAULT_SPIKE_TICKS = 5;

function profileKind(): ProfileKind {
  const kind = stringEnv('ON_BENCH_PROFILE', 'cpu');
  if (kind !== 'cpu' && kind !== 'alloc') {
    throw new Error(`ON_BENCH_PROFILE must be cpu or alloc, got '${kind}'`);
  }
  return kind;
}

/** Profile one run with the sampler `kind` names, summarized; the raw profile is what gets stored. */
async function profiled<T>(
  kind: ProfileKind,
  run: () => Promise<T>,
): Promise<{
  readonly raw: unknown;
  readonly summary: ProfileSummary;
  readonly result: T;
  /** Null for an allocation profile, which has no sample times to cut at a tick. */
  readonly cpu: CpuCapture | null;
}> {
  switch (kind) {
    case 'cpu': {
      const { result, ...cpu } = await captureCpuProfile(run);
      return { raw: cpu.profile, summary: summarizeProfile(cpu.profile), result, cpu };
    }
    case 'alloc': {
      const interval = intEnv('ON_BENCH_ALLOC_INTERVAL', DEFAULT_ALLOCATION_SAMPLING_INTERVAL_BYTES, 1);
      const { profile, result } = await captureAllocationProfile(run, interval);
      return { raw: profile, summary: summarizeAllocations(profile), result, cpu: null };
    }
  }
}

async function main(): Promise<void> {
  const knobs = mapBenchKnobs(DEFAULT_PROFILED_TICKS);
  const kind = profileKind();
  const spikeTicks = intEnv('ON_BENCH_SPIKE_TICKS', DEFAULT_SPIKE_TICKS, 0);
  if (knobs.checkpointMarks.length > 0) {
    throw new Error(
      'bench:profile takes no ON_BENCH_CHECKPOINTS; write the marks with bench:map and name one ' +
        'with ON_BENCH_CHECKPOINT',
    );
  }

  const startedAtMs = Date.now();
  const startMs = performance.now();
  const world = await mapBenchWorld(knobs, knobs.warmupTicks + knobs.measuredTicks);
  for (const line of worldSourceLines(world, knobs)) console.log(line);
  const marching = marchKnobs();
  const march = marching === null ? null : marchProbe(world.sim, marching, world.startTick);

  // Warm up outside the profile: cold-start tiering would otherwise dominate the sample counts.
  for (let i = 0; i < knobs.warmupTicks; i++) {
    world.sim.step();
    march?.afterStep();
  }

  const {
    raw,
    summary,
    cpu,
    result: measured,
  } = await profiled(kind, () =>
    measureWindows(world.sim, {
      warmupTicks: 0,
      measuredTicks: knobs.measuredTicks,
      windows: PROFILE_WINDOWS,
      ...(march === null ? {} : { afterTick: march.afterStep }),
    }),
  );

  const report = reportFrom({
    measurement: measured,
    world: {
      kind: 'realMap',
      mapId: knobs.session.mapId,
      machineSeats: world.machineSeats,
      session: knobs.session.search,
      mapCells: world.mapCells,
      settlersAtStart: measured.settlersAtStart,
      settlersAtEnd: measured.settlersAtEnd,
      buildings: measured.buildings,
    },
    knobs: { ...knobRecord(knobs), ...marchKnobRecord(marching), ON_BENCH_PROFILE: kind },
    ticks: { warmup: knobs.warmupTicks, measured: knobs.measuredTicks },
    stateHash: world.sim.hashState(),
    startedAtMs,
    wallSeconds: (performance.now() - startMs) / 1000,
  });

  const written = storeProfile(benchOutDir(), report, kind, raw);
  console.log(`\n${formatProfile(summary, knobs.measuredTicks)}\n`);
  console.log(`${formatReport(report)}\n`);
  if (cpu !== null && spikeTicks > 0) {
    console.log(`${formatSpikes(tickSpikes(cpu, busiestTickSpans(cpu, measured, spikeTicks)))}\n`);
  }
  console.log(`${kind} profile written to ${written}`);
  console.log(`state hash: ${report.stateHash}\n`);
  if (march !== null) for (const line of march.report(measured)) console.log(line);

  if (summary.functions.length === 0 || summary.sampled === 0) {
    throw new Error('the profiler sampled nothing over the measured ticks');
  }
  if (report.systems.length === 0) throw new Error('the measured ticks ran no systems');
}

await main();
