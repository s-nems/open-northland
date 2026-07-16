/**
 * Chrome Trace Event recording (`?debug=trace`) — the offline profiling path. The live DevTools
 * marks (`?debug=perf`) need DevTools open at the moment of the problem; this instead keeps a
 * bounded in-memory ring of complete-duration events a tester exports after the fact, and a dev
 * opens in Perfetto (ui.perfetto.dev) or DevTools. Same instrumentation points as the marks — the
 * sim's per-system seam plus the frame phases — just a different consumer.
 *
 * Format: Trace Event JSON `ph:"X"` (complete) events, `ts`/`dur` in microseconds, wrapped as
 * `{traceEvents: [...]}` (source basis: the Trace Event format as documented by Perfetto,
 * https://perfetto.dev/docs/getting-started/other-formats).
 */
import type { Simulation } from '@open-northland/sim';
import { downloadJsonFile } from './download.js';
import { installSimInstrument } from './perf-marks.js';

/** The `?debug=` value that turns trace recording on (read at game mount). */
export const TRACE_DEBUG_FLAG = 'trace';

/** One complete-duration slice. `pid`/`tid` are required by viewers; one process/thread is honest. */
export interface TraceEvent {
  readonly name: string;
  readonly ph: 'X';
  /** Event start in MICROseconds (the format's unit; recorded from the `performance.now()` clock). */
  readonly ts: number;
  /** Duration in microseconds. */
  readonly dur: number;
  readonly pid: 0;
  readonly tid: 0;
}

/**
 * Ring capacity ≈ 30 s of gameplay: ~20 per-system events × 12 ticks + 3 frame phases × 60 fps
 * ≈ 420 events/s → ~12.6k; the next power of two leaves headroom for speed ×3.
 */
export const TRACE_CAPACITY = 16384;
const MICROS_PER_MS = 1000;

/** A fixed circular buffer — O(1) push at recording rates where an array-shift ring would churn. */
class TraceRing {
  private readonly slots: (TraceEvent | undefined)[] = new Array(TRACE_CAPACITY);
  private next = 0;
  private filled = false;

  push(event: TraceEvent): void {
    this.slots[this.next] = event;
    this.next = (this.next + 1) % TRACE_CAPACITY;
    if (this.next === 0) this.filled = true;
  }

  /** Retained events, oldest first. */
  list(): TraceEvent[] {
    const tail = this.filled ? this.slots.slice(this.next) : [];
    return [...tail, ...this.slots.slice(0, this.next)].filter((e): e is TraceEvent => e !== undefined);
  }
}

/** The active recording, or `null` — recording costs nothing while off. */
let active: TraceRing | null = null;

export function startTraceRecording(): void {
  active = new TraceRing();
}

export function stopTraceRecording(): void {
  active = null;
}

export function isTraceRecording(): boolean {
  return active !== null;
}

/** Record one slice (no-op while recording is off). Times are `performance.now()` milliseconds. */
export function recordTraceEvent(name: string, startMs: number, endMs: number): void {
  if (active === null) return;
  active.push({
    name,
    ph: 'X',
    ts: Math.round(startMs * MICROS_PER_MS),
    dur: Math.max(0, Math.round((endMs - startMs) * MICROS_PER_MS)),
    pid: 0,
    tid: 0,
  });
}

/** Retained events (oldest first), or `null` while recording is off — the bundle's optional field. */
export function recordedTraceEvents(): TraceEvent[] | null {
  return active?.list() ?? null;
}

/** Hook the sim's per-system seam so every system invocation becomes a `sim/<name>` slice. */
export function installSimTrace(sim: Simulation): void {
  installSimInstrument(sim, recordTraceEvent);
}

/** Serialize the recording as a Perfetto/DevTools-loadable Trace Event JSON file body. */
export function traceFileJson(events: readonly TraceEvent[]): string {
  return JSON.stringify({ traceEvents: events, displayTimeUnit: 'ms' });
}

/** Download the current recording as a `.json` trace file (no-op while recording is off). */
export function downloadTraceFile(): void {
  const events = recordedTraceEvents();
  if (events === null) return;
  downloadJsonFile(
    `opennorthland-trace-${new Date().toISOString().replaceAll(':', '-')}.json`,
    traceFileJson(events),
  );
}
