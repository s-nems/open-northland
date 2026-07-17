/**
 * The benchmark's pure reporting half: raw per-system timing samples in, a {@link BenchReport} and its
 * human table out. Kept free of timing and sim construction so it unit-tests without running a sim
 * (`test/bench-report.test.ts`, in the normal suite) — the measuring half lives in `sim-tick.bench.ts`.
 */

/** One system's cost across the measured window. `sharePct` is its share of the summed per-system
 *  medians — the scale-invariant number a regression check can compare across machines. */
export interface SystemStat {
  readonly name: string;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly sharePct: number;
}

/** The machine-readable benchmark result (the `ON_BENCH_JSON` payload). */
export interface BenchReport {
  readonly world: {
    readonly settlements: number;
    readonly fightersPerSide: number;
    readonly mapCells: { readonly width: number; readonly height: number };
    /** Live settlers at the START of the measured window (the armies take casualties as it runs). */
    readonly settlers: number;
    readonly buildings: number;
  };
  readonly ticks: { readonly warmup: number; readonly measured: number };
  /** Wall cost of a whole `step()` — the budget the per-system rows break down. */
  readonly tickMs: { readonly medianMs: number; readonly p95Ms: number };
  /** Per-system rows, heaviest median first. */
  readonly systems: readonly SystemStat[];
  /** The measured run's end state — two runs of the same world must report the same hash. */
  readonly stateHash: string;
}

/**
 * Nearest-rank percentile of a timing sample (`p` in 0..100). Nearest-rank (not interpolated) keeps
 * every reported number an actually-observed tick cost, and needs no special case for tiny windows.
 * Returns 0 for an empty sample.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

/** Fold the raw samples into the report. `perSystem` holds one sample per system per measured tick;
 *  `tickSamples` one per measured tick. Rows come out heaviest median first, ties broken by name so
 *  the report is stable across runs. */
export function summarize(
  perSystem: ReadonlyMap<string, readonly number[]>,
  tickSamples: readonly number[],
  meta: {
    readonly world: BenchReport['world'];
    readonly ticks: BenchReport['ticks'];
    readonly stateHash: string;
  },
): BenchReport {
  const medians = new Map<string, number>();
  for (const [name, samples] of perSystem) medians.set(name, percentile(samples, 50));
  const medianTotal = [...medians.values()].reduce((a, b) => a + b, 0);

  const systems: SystemStat[] = [...perSystem.keys()]
    .map((name) => ({
      name,
      medianMs: medians.get(name) as number,
      p95Ms: percentile(perSystem.get(name) as readonly number[], 95),
      // A zero total (an empty window) would make every share NaN — report 0 instead.
      sharePct: medianTotal === 0 ? 0 : ((medians.get(name) as number) / medianTotal) * 100,
    }))
    // Codepoint order, not localeCompare: ICU collation varies by environment (AGENTS.md).
    .sort((a, b) => b.medianMs - a.medianMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    world: meta.world,
    ticks: meta.ticks,
    tickMs: { medianMs: percentile(tickSamples, 50), p95Ms: percentile(tickSamples, 95) },
    systems,
    stateHash: meta.stateHash,
  };
}

function ms(value: number): string {
  return value.toFixed(3);
}

/** The human-readable table (stdout). The machine-readable twin is the {@link BenchReport} itself. */
export function formatReport(report: BenchReport): string {
  const { world, ticks, tickMs } = report;
  const lines = [
    `sim benchmark — ${world.settlements} settlement(s) + ${world.fightersPerSide}v${world.fightersPerSide} fighters`,
    `world: ${world.mapCells.width}x${world.mapCells.height} cells, ${world.settlers} settlers, ${world.buildings} buildings`,
    `ticks: ${ticks.warmup} warmup + ${ticks.measured} measured   state hash: ${report.stateHash}`,
    `tick total: median ${ms(tickMs.medianMs)} ms   p95 ${ms(tickMs.p95Ms)} ms`,
    '',
    `${'system'.padEnd(16)}${'median ms'.padStart(11)}${'p95 ms'.padStart(11)}${'share'.padStart(9)}`,
    '-'.repeat(47),
  ];
  for (const s of report.systems) {
    lines.push(
      `${s.name.padEnd(16)}${ms(s.medianMs).padStart(11)}${ms(s.p95Ms).padStart(11)}${`${s.sharePct.toFixed(1)}%`.padStart(9)}`,
    );
  }
  return lines.join('\n');
}
