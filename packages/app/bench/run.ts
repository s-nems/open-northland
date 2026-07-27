/**
 * Turning a {@link Measurement} into a published report. Both benchmarks differ only in the world they
 * built and the knobs they read, so the trust verdict, the environment capture and the JSON payload
 * are assembled once here rather than drifting apart in two entry files.
 */
import { writeFileSync } from 'node:fs';
import { captureEnvironment } from './environment.js';
import type { Measurement } from './measure.js';
import { assessTrust, type BenchReport, type BenchWorld, formatReport, summarize } from './report/index.js';

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

/** Print the human table and, when `ON_BENCH_JSON` names a path, write the machine-readable twin. */
export function publishReport(report: BenchReport): void {
  console.log(`\n${formatReport(report)}\n`);
  const jsonPath = process.env.ON_BENCH_JSON?.trim();
  if (jsonPath === undefined || jsonPath === '') return;
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report written to ${jsonPath}\n`);
}
