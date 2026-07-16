/**
 * Per-system + per-phase User Timing marks (`?debug=perf`) — the local-dev profiling path. Chrome
 * DevTools' Performance panel shows `performance.measure` entries in its Timings track with zero
 * further UI, so one recording shows the whole frame anatomy: `frame/*` phases with `sim/<system>`
 * slices inside. Same instrumentation seam the bench harness injects its own timer through
 * (docs/tickets/sim/perf-benchmark-harness.md).
 */
import type { Simulation } from '@open-northland/sim';

/** The `?debug=` value that turns the marks on (read at game mount). */
export const PERF_MARKS_DEBUG_FLAG = 'perf';

/** Emit one named interval into the DevTools timeline, keeping the User Timing buffer empty. */
export function emitPerfMeasure(name: string, startMs: number, endMs: number): void {
  performance.measure(name, { start: startMs, end: endMs });
  // The panel captures the measure as it happens; clearing just stops the buffer growing unbounded.
  performance.clearMeasures(name);
}

/** Hook the sim's per-system seam so every system invocation becomes a `sim/<name>` measure. */
export function installSimPerfMarks(sim: Simulation): void {
  sim.setInstrument((name, run) => {
    const start = performance.now();
    run();
    emitPerfMeasure(`sim/${name}`, start, performance.now());
  });
}
