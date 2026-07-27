/**
 * Whether a measurement is worth reading at all. A benchmark that reports confident numbers from a
 * contended or drifting machine is worse than one that reports nothing, because the numbers get
 * quoted. Three ratios, any one of which flips the verdict; deliberately not a statistics package.
 */
import type { BenchTrust, BenchWindow } from './types.js';

/** A box running more than this many runnable threads per core was not measuring your code. */
const MAX_LOAD_PER_CPU = 1.5;
/** The machine's own speed must hold across the run, or the first and last window medians are not
 *  comparable - which is the central claim of every growth number in the report. */
const MAX_CALIBRATION_DRIFT = 1.25;
/** Within one window the world barely changes, so a p95 this far above the median is preemption or
 *  GC, not growth. */
const MAX_WINDOW_SPIKE_RATIO = 4;

export interface TrustInputs {
  /** Null where the OS reports no load average; the check is then skipped, not failed. */
  readonly loadPerCpu: number | null;
  readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
  readonly windows: readonly BenchWindow[];
}

function calibrationDrift(beforeMs: number, afterMs: number): number {
  if (beforeMs <= 0 || afterMs <= 0) return 1;
  return Math.max(beforeMs, afterMs) / Math.min(beforeMs, afterMs);
}

function spikingWindow(windows: readonly BenchWindow[]): BenchWindow | undefined {
  return windows.find(
    (w) => w.tickMs.medianMs > 0 && w.tickMs.p95Ms / w.tickMs.medianMs > MAX_WINDOW_SPIKE_RATIO,
  );
}

export function assessTrust(inputs: TrustInputs): BenchTrust {
  const warnings: string[] = [];
  const { loadPerCpu, calibration } = inputs;

  if (loadPerCpu !== null && loadPerCpu > MAX_LOAD_PER_CPU) {
    warnings.push(`load average was ${loadPerCpu.toFixed(2)} per cpu - this box was busy`);
  }

  const drift = calibrationDrift(calibration.beforeMs, calibration.afterMs);
  if (drift > MAX_CALIBRATION_DRIFT) {
    warnings.push(
      `the machine's own speed drifted ${drift.toFixed(2)}x across the run ` +
        `(${calibration.beforeMs.toFixed(2)} ms -> ${calibration.afterMs.toFixed(2)} ms)`,
    );
  }

  const spike = spikingWindow(inputs.windows);
  if (spike !== undefined) {
    const ratio = spike.tickMs.p95Ms / spike.tickMs.medianMs;
    warnings.push(
      `window ${spike.index + 1} p95 is ${ratio.toFixed(1)}x its median - preemption or GC, not growth`,
    );
  }

  return { trustworthy: warnings.length === 0, warnings };
}
