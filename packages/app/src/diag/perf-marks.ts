/**
 * User Timing marks (`?debug=perf`): `performance.measure` entries appear in the DevTools Performance
 * panel's Timings track, so a recording shows `frame/*` phases with `sim/<system>` slices inside.
 */

/** The `?debug=` value that turns the marks on. */
export const PERF_MARKS_DEBUG_FLAG = 'perf';

export function emitPerfMeasure(name: string, startMs: number, endMs: number): void {
  performance.measure(name, { start: startMs, end: endMs });
  // The panel captures the measure as it happens; clearing only stops the buffer growing unbounded.
  performance.clearMeasures(name);
}
