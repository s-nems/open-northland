/**
 * Turning a {@link Measurement} into a published report. Both benchmarks differ only in the world they
 * built and the knobs they read, so the trust verdict, the environment capture and the JSON payload
 * are assembled once here rather than drifting apart in two entry files.
 */
import { captureEnvironment } from './environment.js';
import type { Measurement } from './measure.js';
import { assessTrust, type BenchReport, type BenchWorld, formatReport, summarize } from './report/index.js';
import { benchOutDir, storeReport, writeReport } from './store.js';

export interface RunOptions {
  readonly measurement: Measurement;
  readonly world: BenchWorld;
  /** The knobs actually in effect, recorded so a stale report cannot be read as another configuration. */
  readonly knobs: Readonly<Record<string, string>>;
  readonly ticks: { readonly warmup: number; readonly measured: number };
  readonly stateHash: string;
  readonly startedAtMs: number;
  readonly wallSeconds: number;
}

export function reportFrom(options: RunOptions): BenchReport {
  const { measurement } = options;
  return summarize(measurement.perSystem, measurement.tickSamples, {
    world: options.world,
    ticks: { ...options.ticks, windows: measurement.windows.length },
    firstTick: measurement.firstTick,
    windows: measurement.windows,
    environment: captureEnvironment({
      knobs: options.knobs,
      startedAtMs: options.startedAtMs,
      wallSeconds: options.wallSeconds,
      loadPerCpu: measurement.loadPerCpu,
      peakRssMb: measurement.peakRssMb,
      calibration: measurement.calibration,
    }),
    trust: assessTrust({
      loadPerCpu: measurement.loadPerCpu,
      calibration: measurement.calibration,
      windows: measurement.windows,
    }),
    stateHash: options.stateHash,
  });
}

/**
 * Print the human table and keep the machine-readable twin: at `ON_BENCH_JSON` when it names a path,
 * otherwise under `bench-out/`. Every run is kept, so a baseline exists without having been planned.
 */
export function publishReport(report: BenchReport): void {
  console.log(`\n${formatReport(report)}\n`);
  const jsonPath = process.env.ON_BENCH_JSON?.trim();
  const written =
    jsonPath === undefined || jsonPath === ''
      ? storeReport(benchOutDir(), report)
      : writeReport(jsonPath, report);
  console.log(`report written to ${written}\n`);
}
