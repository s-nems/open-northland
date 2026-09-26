/**
 * The host's instrument slot takes one hook, so every consumer of the per-system seam is fanned out
 * from this one installer.
 */
import type { ProfileSource, SessionHost } from '../session/index.js';
import { hasDebugFlag } from './debug-flags.js';
import { emitPerfMeasure, PERF_MARKS_DEBUG_FLAG } from './perf-marks.js';
import { PROFILE_DEBUG_FLAG } from './system-profile.js';
import { recordTraceEvent, startTraceRecording, TRACE_DEBUG_FLAG } from './trace.js';

/** Emits one named interval to every consumer the active flags asked for. */
export type PhaseEmitter = (name: string, startMs: number, endMs: number) => void;

/** With no `?debug=` flag set nothing is installed, so an ordinary session keeps the sim's direct call.
 *  Returns the running profile when `?debug=profile` asked for one. */
export function installSessionInstruments(
  host: Pick<SessionHost, 'installInstruments'>,
  params: URLSearchParams,
): ProfileSource | null {
  const profile = hasDebugFlag(params, PROFILE_DEBUG_FLAG);
  const emit = framePhaseEmitter(params);
  if (!profile && emit === null) return null;

  if (hasDebugFlag(params, TRACE_DEBUG_FLAG)) startTraceRecording();
  return host.installInstruments({
    profile,
    spans: emit === null ? null : (system, start, end) => emit(`sim/${system}`, start, end),
  });
}

/** The emitter for the loop's `frame/*` phase slices, or `null` when no active flag consumes them. */
export function framePhaseEmitter(params: URLSearchParams): PhaseEmitter | null {
  const marks = hasDebugFlag(params, PERF_MARKS_DEBUG_FLAG);
  const trace = hasDebugFlag(params, TRACE_DEBUG_FLAG);
  if (!marks && !trace) return null;
  return (name, startMs, endMs) => {
    if (marks) emitPerfMeasure(name, startMs, endMs);
    if (trace) recordTraceEvent(name, startMs, endMs);
  };
}
