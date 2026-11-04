/** The benchmarks' machine-readable result shapes (the `ON_BENCH_JSON` payload). Plain data only. */

/** The report layout the reader accepts; a layout change bumps it, and a report of any other version is
 *  refused rather than read. */
export const BENCH_REPORT_VERSION = 8;

/** One system's cost across a measured segment. `sharePct` is its share of the summed per-system
 *  time - the scale-invariant number a regression check can compare across machines. */
export interface SystemStat {
  readonly name: string;
  /** Summed cost over the segment's ticks divided by their count: what a system that works one tick
   *  in many (an AI seat every 24 ticks) really costs, which its median puts at zero. */
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  /** The system's single worst tick in the segment: what a lockstep session waits for. */
  readonly maxMs: number;
  readonly sharePct: number;
}

/** Wall cost of a whole instrumented `step()`. The per-system rows do not sum to it: the residual is
 *  scheduling plus the harness's own two `performance.now` calls per system. */
export interface TickStat {
  /** Mean tick time, the measured total divided by the ticks: the throughput a fast-forwarded game runs at. */
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/** One of the run's slowest ticks: where a stutter came from, not how the average was spent. */
export interface SlowTick {
  /** The sim tick, as `sim.tick` read after the step. */
  readonly tick: number;
  readonly totalMs: number;
  /** The systems that cost most in that tick, heaviest first. */
  readonly systems: readonly { readonly name: string; readonly ms: number }[];
}

interface WorldCounts {
  readonly mapCells: { readonly width: number; readonly height: number };
  /** Live settlers at the start / end of the measured window. A gap means the medians span two
   *  populations - a resolving battle, or a settlement that grew across the run. */
  readonly settlersAtStart: number;
  readonly settlersAtEnd: number;
  readonly buildings: number;
}

/** The two benchmarks measure different worlds. The tag lets the comparison tool refuse to compare
 *  a synthetic run against a real map, which would silently report nonsense deltas. */
export type BenchWorld =
  | (WorldCounts & {
      readonly kind: 'synthetic';
      readonly settlements: number;
      readonly fightersPerSide: number;
      readonly hunters: number;
    })
  | (WorldCounts & {
      readonly kind: 'realMap';
      readonly mapId: string;
      /** Every seat the session runs under AI, ascending: the requested seats plus the map's own
       *  computer seats, which the browser session runs whatever `?computer=` lists. */
      readonly machineSeats: readonly number[];
      /** The session's canonical search (`BenchSession.search`): runs of different difficulties,
       *  tribes or rules never compare. */
      readonly session: string;
    });

/** Garbage collection inside one window, from V8's `gc` performance entries. */
export interface GcStat {
  readonly count: number;
  /** Summed pause time. */
  readonly ms: number;
  /** The longest single pause. */
  readonly maxMs: number;
}

/** One measured segment of the run (see `measure.ts` for why cost is reported along this axis). */
export interface BenchWindow {
  readonly index: number;
  /** Inclusive sim-tick bounds of the segment. */
  readonly fromTick: number;
  readonly toTick: number;
  readonly tickMs: TickStat;
  readonly systems: readonly SystemStat[];
  readonly population: {
    readonly settlers: number;
    /** The settlers in a soldier or hero job: the combat-scale axis the economy counts hide. */
    readonly fighters: number;
    readonly buildings: number;
    readonly resourceNodes: number;
  };
  /** Resident set size at the segment boundary, process-wide: it includes the harness's own per-tick
   *  sample buffers, which grow with the tick count. A monotone climb is a finding about the run, not
   *  proof of a leak in the world. */
  readonly rssMb: number;
  /** V8 heap in use at the segment boundary, after the segment's own garbage was or was not collected. */
  readonly heapUsedMb: number;
  readonly gc: GcStat;
  /** Main-thread CPU time (user + system) per tick, read at the segment's bounds. Unlike the wall
   *  tick it does not count time the thread waited for a core, so it moves less with machine load.
   *  It includes the harness's per-tick hooks and instrument, and excludes GC work on helper threads. */
  readonly cpuMsPerTick: number;
  /** V8 bytes allocated per tick (KiB), from the isolate's cumulative counter at the segment's bounds:
   *  nearly load-independent, the number allocation work moves. Includes the harness's own samples.
   *  Null on a runtime without the counter. */
  readonly allocKbPerTick: number | null;
}

/** Machine and run context; `trust.ts` turns it into a verdict. */
export interface BenchEnvironment {
  readonly node: string;
  readonly platform: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  /** 1-minute load average over cpu count, or null where the OS reports none (Windows gives zeros). */
  readonly loadPerCpu: number | null;
  readonly totalMemMb: number;
  readonly peakRssMb: number;
  readonly startedAt: string;
  readonly wallSeconds: number;
  /** Commit and working-tree state, so two reports from the same dirty tree are recognisable as such. */
  readonly rev: string | null;
  readonly dirty: boolean | null;
  /** The knobs actually in effect for this run. */
  readonly knobs: Readonly<Record<string, string>>;
  /** The machine-speed yardstick, run once before the first window and once after the last. */
  readonly calibrationMs: { readonly beforeMs: number; readonly afterMs: number };
}

/** The verdict from `assessTrust`. `warnings` carries one human line per failed check. */
export interface BenchTrust {
  readonly trustworthy: boolean;
  readonly warnings: readonly string[];
}

export interface BenchReport {
  readonly version: typeof BENCH_REPORT_VERSION;
  readonly world: BenchWorld;
  readonly ticks: {
    readonly warmup: number;
    readonly measured: number;
    readonly windows: number;
  };
  readonly tickMs: TickStat;
  /** Whole-run {@link BenchWindow.cpuMsPerTick} and {@link BenchWindow.allocKbPerTick}. */
  readonly cpuMsPerTick: number;
  readonly allocKbPerTick: number | null;
  /** Whole-run per-system rows, heaviest median first. */
  readonly systems: readonly SystemStat[];
  /** The run's slowest ticks, slowest first. */
  readonly slowestTicks: readonly SlowTick[];
  /** Per system, how many slow ticks (over {@link SLOW_TICK_FACTOR} times the median) it topped. Omits
   *  systems that topped none. */
  readonly stutterSources: readonly { readonly name: string; readonly slowTicks: number }[];
  /** Always at least one entry; the growth tables print only when there are several. */
  readonly windows: readonly BenchWindow[];
  readonly environment: BenchEnvironment;
  readonly trust: BenchTrust;
  /** The measured run's end state - two runs of the same world must report the same hash. */
  readonly stateHash: string;
}
