/**
 * Per-system + per-phase User Timing marks (`?debug=perf`) - the local-dev profiling path. Chrome
 * DevTools' Performance panel shows `performance.measure` entries in its Timings track with zero
 * further UI, so one recording shows the whole frame anatomy: `frame/*` phases with `sim/<system>`
 * slices inside. Same instrumentation seam the sim benchmark (`npm run bench:sim`) times through.
 */

/** The `?debug=` value that turns the marks on (read at game mount). */
export const PERF_MARKS_DEBUG_FLAG = 'perf';

/** Emit one named interval into the DevTools timeline, keeping the User Timing buffer empty. */
export function emitPerfMeasure(name: string, startMs: number, endMs: number): void {
  performance.measure(name, { start: startMs, end: endMs });
  // The panel captures the measure as it happens; clearing just stops the buffer growing unbounded.
  performance.clearMeasures(name);
}
