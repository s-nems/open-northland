/**
 * Chrome Trace Event recording (`?debug=trace`): a bounded in-memory ring of complete-duration events
 * a tester exports after the fact and a dev opens in Perfetto or DevTools.
 *
 * Format: Trace Event JSON `ph:"X"` (complete) events, `ts`/`dur` in microseconds, wrapped as
 * `{traceEvents: [...]}` (source basis: the Trace Event format as documented by Perfetto,
 * https://perfetto.dev/docs/getting-started/other-formats).
 */
import { downloadJsonFile } from './download.js';

/** The `?debug=` value that turns trace recording on. */
export const TRACE_DEBUG_FLAG = 'trace';

/** One complete-duration slice; `pid`/`tid` are required by viewers. */
export interface TraceEvent {
  readonly name: string;
  readonly ph: 'X';
  /** Event start in microseconds, the format's unit, taken from the `performance.now()` clock. */
  readonly ts: number;
  /** Duration in microseconds. */
  readonly dur: number;
  readonly pid: 0;
  readonly tid: 0;
}

/** Ring capacity for roughly 30 s of gameplay at about 420 events/s, rounded up to a power of two. */
export const TRACE_CAPACITY = 16384;
const MICROS_PER_MS = 1000;

/** A fixed circular buffer; O(1) push where an array-shift ring would churn at recording rates. */
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

/** Record one slice; `startMs` and `endMs` are `performance.now()` milliseconds. */
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

/** Retained events oldest first, or `null` while recording is off. */
export function recordedTraceEvents(): TraceEvent[] | null {
  return active?.list() ?? null;
}

export function traceFileJson(events: readonly TraceEvent[]): string {
  return JSON.stringify({ traceEvents: events, displayTimeUnit: 'ms' });
}

/** No-op while recording is off. */
export function downloadTraceFile(): void {
  const events = recordedTraceEvents();
  if (events === null) return;
  downloadJsonFile(
    `opennorthland-trace-${new Date().toISOString().replaceAll(':', '-')}.json`,
    traceFileJson(events),
  );
}
