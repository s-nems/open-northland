/**
 * The benchmark's machine-readable result shapes (the `ON_BENCH_JSON` payload). Plain data only, so
 * the folds in `summarize.ts`, the rule in `trust.ts` and the tables in `format.ts` all unit-test
 * without running a sim.
 */

/** One system's cost across a measured segment. `sharePct` is its share of the summed per-system
 *  medians - the scale-invariant number a regression check can compare across machines. */
export interface SystemStat {
  readonly name: string;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly sharePct: number;
}

/** Wall cost of a whole instrumented `step()`. The per-system rows do not sum to it: the residual is
 *  scheduling plus the harness's own two `performance.now` calls per system. */
export interface TickStat {
  readonly medianMs: number;
  readonly p95Ms: number;
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
    })
  | (WorldCounts & {
      readonly kind: 'realMap';
      readonly mapId: string;
      readonly aiSeats: number;
    });

/** One measured segment of the run. A single median over a developing settlement is the number that
 *  hides the question the benchmark exists to answer, so cost is always reported along this axis. */
export interface BenchWindow {
  readonly index: number;
  /** Inclusive sim-tick bounds of the segment. */
  readonly fromTick: number;
  readonly toTick: number;
  readonly tickMs: TickStat;
  readonly systems: readonly SystemStat[];
  readonly population: {
    readonly settlers: number;
    readonly buildings: number;
    readonly resourceNodes: number;
  };
  /** Resident set size at the segment boundary. A monotone climb across windows is itself a finding. */
  readonly rssMb: number;
}

/** Machine and run context, recorded so a stale or noisy report cannot be read as a clean one. */
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
  readonly world: BenchWorld;
  readonly ticks: {
    readonly warmup: number;
    readonly measured: number;
    readonly windows: number;
  };
  readonly tickMs: TickStat;
  /** Whole-run per-system rows, heaviest median first. */
  readonly systems: readonly SystemStat[];
  /** Always at least one entry; the growth tables print only when there are several. */
  readonly windows: readonly BenchWindow[];
  readonly environment: BenchEnvironment;
  readonly trust: BenchTrust;
  /** The measured run's end state - two runs of the same world must report the same hash. */
  readonly stateHash: string;
}
