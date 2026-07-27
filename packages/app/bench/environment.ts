/** Gathers the machine and run context every report carries. `report/trust.ts` judges it. */
import { execFileSync } from 'node:child_process';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import type { BenchEnvironment } from './report/index.js';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Iterations of the calibration kernel. Sized so one call lands in the low milliseconds: long enough
 * that scheduler noise averages out, short enough to run twice per benchmark for free.
 */
const CALIBRATION_ITERATIONS = 2_000_000;

function calibrationKernel(): number {
  let accumulator = 0;
  for (let i = 1; i <= CALIBRATION_ITERATIONS; i++) accumulator += Math.sqrt(i) / i;
  return accumulator;
}

/**
 * How long a fixed numeric kernel takes on this box, right now. Its runtime is constant on an idle
 * machine, so a drift between the call before the first window and the one after the last means the
 * machine changed speed under the benchmark, not that the sim did.
 */
export function calibrationMs(): number {
  // Warm first: an unoptimised opening pass would read as a slow machine and flag every clean run.
  calibrationKernel();
  const start = performance.now();
  const accumulator = calibrationKernel();
  const elapsed = performance.now() - start;
  // Consume the accumulator: an unread result lets the optimizer delete the loop being timed.
  if (!Number.isFinite(accumulator)) throw new Error('calibration kernel diverged');
  return elapsed;
}

/** 1-minute load average over cpu count, or null where the OS reports none (Windows gives zeros). */
export function loadPerCpu(): number | null {
  const [oneMinute] = loadavg();
  if (oneMinute === undefined || oneMinute === 0) return null;
  const count = cpus().length;
  return count === 0 ? null : oneMinute / count;
}

/** The commit a report was measured at, and whether the tree was dirty. Null outside a checkout with
 *  git available, where a report is still useful but cannot be attributed to a revision. */
function revision(): { readonly rev: string | null; readonly dirty: boolean | null } {
  try {
    const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    return { rev, dirty: status.trim() !== '' };
  } catch {
    return { rev: null, dirty: null };
  }
}

export interface RunContext {
  readonly knobs: Readonly<Record<string, string>>;
  readonly startedAtMs: number;
  readonly wallSeconds: number;
  readonly loadPerCpu: number | null;
  readonly peakRssMb: number;
  readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
}

export function captureEnvironment(run: RunContext): BenchEnvironment {
  return {
    node: process.version,
    platform: `${platform()}-${arch()}`,
    cpuModel: cpus().at(0)?.model ?? 'unknown',
    cpuCount: cpus().length,
    loadPerCpu: run.loadPerCpu,
    totalMemMb: Math.round(totalmem() / BYTES_PER_MB),
    peakRssMb: run.peakRssMb,
    startedAt: new Date(run.startedAtMs).toISOString(),
    wallSeconds: run.wallSeconds,
    ...revision(),
    knobs: run.knobs,
    calibrationMs: run.calibration,
  };
}
