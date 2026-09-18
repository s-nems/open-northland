/**
 * The benchmarks' pure statistics: raw per-system timing samples in, report rows out. Kept free of
 * timing and sim construction so it unit-tests without running a sim (`test/bench-report.test.ts`,
 * in the normal suite).
 */
import type {
  BenchEnvironment,
  BenchReport,
  BenchTrust,
  BenchWindow,
  BenchWorld,
  SlowTick,
  SystemStat,
  TickStat,
} from './types.js';

/** How many of the slowest ticks a report names, and how many systems each names. Enough to see whether
 *  a stutter has one source or many. */
const SLOWEST_TICKS = 5;
const SYSTEMS_PER_SLOW_TICK = 3;
/** A tick this many times the median counts as a stutter: at x3 speed one such tick costs a frame. */
export const SLOW_TICK_FACTOR = 2;

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

/** The slowest measured ticks with the systems that filled them. Ties keep the earlier tick, so the
 *  list is stable for a given run. */
export function slowestTicks(
  perSystem: ReadonlyMap<string, readonly number[]>,
  tickSamples: readonly number[],
): readonly SlowTick[] {
  return tickSamples
    .map((totalMs, index) => ({ totalMs, index }))
    .sort((a, b) => b.totalMs - a.totalMs || a.index - b.index)
    .slice(0, SLOWEST_TICKS)
    .map(({ totalMs, index }) => ({
      index,
      totalMs,
      systems: [...perSystem]
        .map(([name, samples]) => ({ name, ms: samples[index] ?? 0 }))
        .sort((a, b) => b.ms - a.ms || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, SYSTEMS_PER_SLOW_TICK),
    }));
}

/** Which system topped each slow tick, counted per system, most often first. */
export function stutterSources(
  perSystem: ReadonlyMap<string, readonly number[]>,
  tickSamples: readonly number[],
): readonly { readonly name: string; readonly slowTicks: number }[] {
  const threshold = percentile(tickSamples, 50) * SLOW_TICK_FACTOR;
  const counts = new Map<string, number>();
  tickSamples.forEach((totalMs, index) => {
    if (totalMs <= threshold) return;
    let top: { name: string; ms: number } | null = null;
    for (const [name, samples] of perSystem) {
      const ms = samples[index] ?? 0;
      if (top === null || ms > top.ms) top = { name, ms };
    }
    if (top !== null) counts.set(top.name, (counts.get(top.name) ?? 0) + 1);
  });
  return [...counts]
    .map(([name, slowTicks]) => ({ name, slowTicks }))
    .sort((a, b) => b.slowTicks - a.slowTicks || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
    slowestTicks: slowestTicks(perSystem, tickSamples),
    stutterSources: stutterSources(perSystem, tickSamples),
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
