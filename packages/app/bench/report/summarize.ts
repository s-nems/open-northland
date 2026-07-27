/**
 * The benchmark's pure statistics: raw per-system timing samples in, report rows out. Kept free of
 * timing and sim construction so it unit-tests without running a sim (`test/bench-report.test.ts`,
 * in the normal suite).
 */
import type {
  BenchEnvironment,
  BenchReport,
  BenchTrust,
  BenchWindow,
  BenchWorld,
  SystemStat,
  TickStat,
} from './types.js';

/**
 * Nearest-rank percentile of a timing sample (`p` in 0..100). Nearest-rank (not interpolated) keeps
 * every reported number an actually-observed tick cost, and needs no special case for tiny windows.
 * Returns 0 for an empty sample.
 */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0; // empty sample -> 0
}

/** One segment's folded rows. Shares are share-of-segment, so a window's rows sum within that window. */
export interface Segment {
  readonly tickMs: TickStat;
  readonly systems: readonly SystemStat[];
}

/** The fold every window and the whole run share. Rows come out heaviest median first, ties broken
 *  by name so a report is stable across runs. */
export function summarizeSegment(
  perSystem: ReadonlyMap<string, readonly number[]>,
  tickSamples: readonly number[],
): Segment {
  const rows = [...perSystem].map(([name, samples]) => ({
    name,
    medianMs: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
  }));
  const medianTotal = rows.reduce((sum, r) => sum + r.medianMs, 0);

  const systems: SystemStat[] = rows
    // A zero total (an empty window) would make every share NaN - report 0 instead.
    .map((r) => ({ ...r, sharePct: medianTotal === 0 ? 0 : (r.medianMs / medianTotal) * 100 }))
    // Codepoint order, not localeCompare: ICU collation varies by environment (AGENTS.md).
    .sort((a, b) => b.medianMs - a.medianMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { tickMs: { medianMs: percentile(tickSamples, 50), p95Ms: percentile(tickSamples, 95) }, systems };
}

/** Fold the whole run into the report. `perSystem` holds one sample per system per measured tick;
 *  `tickSamples` one per measured tick. */
export function summarize(
  perSystem: ReadonlyMap<string, readonly number[]>,
  tickSamples: readonly number[],
  meta: {
    readonly world: BenchWorld;
    readonly ticks: BenchReport['ticks'];
    readonly windows: readonly BenchWindow[];
    readonly environment: BenchEnvironment;
    readonly trust: BenchTrust;
    readonly stateHash: string;
  },
): BenchReport {
  const { tickMs, systems } = summarizeSegment(perSystem, tickSamples);
  return {
    world: meta.world,
    ticks: meta.ticks,
    tickMs,
    systems,
    windows: meta.windows,
    environment: meta.environment,
    trust: meta.trust,
    stateHash: meta.stateHash,
  };
}

/** A system's cost in the first window against the last - the growth axis. `factor` is null when the
 *  first window measured zero, where a ratio would be meaningless rather than infinite. */
export interface SystemGrowth {
  readonly name: string;
  readonly firstMs: number;
  readonly lastMs: number;
  readonly factor: number | null;
  readonly lastSharePct: number;
}

/** First-vs-last window per system, heaviest last window first. Empty for a single-window run. */
export function systemGrowth(windows: readonly BenchWindow[]): readonly SystemGrowth[] {
  const first = windows.at(0);
  const last = windows.at(-1);
  if (first === undefined || last === undefined || first === last) return [];

  const firstMsByName = new Map(first.systems.map((s) => [s.name, s.medianMs]));
  return last.systems.map((s) => {
    const firstMs = firstMsByName.get(s.name) ?? 0;
    return {
      name: s.name,
      firstMs,
      lastMs: s.medianMs,
      factor: firstMs === 0 ? null : s.medianMs / firstMs,
      lastSharePct: s.sharePct,
    };
  });
}
