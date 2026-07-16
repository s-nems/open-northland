import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDiagnosticsBundle,
  DiagLog,
  recordedTraceEvents,
  recordTraceEvent,
  startTraceRecording,
  stopTraceRecording,
  TRACE_CAPACITY,
  type TraceEvent,
  traceFileJson,
} from '../src/diag/index.js';

afterEach(() => stopTraceRecording());

describe('trace recording', () => {
  it('costs nothing while off: recording is a no-op and there is nothing to export', () => {
    stopTraceRecording();
    recordTraceEvent('sim/movement', 1, 2);
    expect(recordedTraceEvents()).toBeNull();
  });

  it('records complete-duration events in the Trace Event shape (microseconds)', () => {
    startTraceRecording();
    recordTraceEvent('sim/movement', 10, 12.5);
    recordTraceEvent('frame/draw', 12.5, 12.5); // zero-width slices must not go negative
    const events = recordedTraceEvents();
    expect(events).toEqual([
      { name: 'sim/movement', ph: 'X', ts: 10_000, dur: 2500, pid: 0, tid: 0 },
      { name: 'frame/draw', ph: 'X', ts: 12_500, dur: 0, pid: 0, tid: 0 },
    ]);
  });

  it('bounds the ring: overflow drops the oldest events', () => {
    startTraceRecording();
    const OVERFLOW = 5;
    for (let i = 0; i < TRACE_CAPACITY + OVERFLOW; i++) recordTraceEvent(`e${i}`, i, i + 1);
    const events = recordedTraceEvents();
    expect(events).toHaveLength(TRACE_CAPACITY);
    expect(events?.[0]?.name).toBe(`e${OVERFLOW}`);
    expect(events?.at(-1)?.name).toBe(`e${TRACE_CAPACITY + OVERFLOW - 1}`);
  });

  it('serializes as a Perfetto-loadable traceEvents file body', () => {
    startTraceRecording();
    recordTraceEvent('sim/job', 0, 1);
    const parsed = JSON.parse(traceFileJson(recordedTraceEvents() ?? [])) as {
      traceEvents: TraceEvent[];
    };
    expect(parsed.traceEvents).toHaveLength(1);
    expect(parsed.traceEvents[0]?.ph).toBe('X');
  });

  it('attaches to the diagnostics bundle only while recording', () => {
    const log = new DiagLog({ consoleLevel: 'silent', now: () => 1 });
    expect(buildDiagnosticsBundle(log, null, null).trace).toBeUndefined();
    startTraceRecording();
    recordTraceEvent('sim/vision', 3, 4);
    const bundle = buildDiagnosticsBundle(log, null);
    expect(bundle.trace).toHaveLength(1);
  });
});
