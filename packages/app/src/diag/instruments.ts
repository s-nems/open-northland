/**
 * One installer for the session's sim instrumentation. `Simulation.setInstrument` has a single slot,
 * so every consumer of the per-system seam has to be fanned out from one hook or the last one
 * installed silently wins.
 */
import type { Simulation } from '@open-northland/sim';
import { hasDebugFlag } from './debug-flags.js';
import { emitPerfMeasure, PERF_MARKS_DEBUG_FLAG } from './perf-marks.js';
import { PROFILE_DEBUG_FLAG, SystemProfile } from './system-profile.js';
import { recordTraceEvent, startTraceRecording, TRACE_DEBUG_FLAG } from './trace.js';

/** Emits one named interval to every consumer the active flags asked for. */
export type PhaseEmitter = (name: string, startMs: number, endMs: number) => void;

/**
 * Install the sim instrument for the active `?debug=` flags and return the running profile when one
 * was asked for. With no flag set nothing is installed, so an ordinary session keeps the sim's
 * uninstrumented direct call.
 */
export function installSessionInstruments(sim: Simulation, params: URLSearchParams): SystemProfile | null {
  const profile = hasDebugFlag(params, PROFILE_DEBUG_FLAG) ? new SystemProfile() : null;
  const emit = framePhaseEmitter(params);
  if (profile === null && emit === null) return null;

  if (hasDebugFlag(params, TRACE_DEBUG_FLAG)) startTraceRecording();
  sim.setInstrument((name, run) => {
    // Timed tight around `run`; the fan-out below lands outside the interval.
    const start = performance.now();
    run();
    const end = performance.now();
    profile?.record(name, end - start);
    emit?.(`sim/${name}`, start, end);
  });
  return profile;
}

/**
 * The emitter for the loop's `frame/*` phase slices, or null when no flag consumes them. The running
 * profile is per-system only, so it does not appear here.
 */
export function framePhaseEmitter(params: URLSearchParams): PhaseEmitter | null {
  const marks = hasDebugFlag(params, PERF_MARKS_DEBUG_FLAG);
  const trace = hasDebugFlag(params, TRACE_DEBUG_FLAG);
  if (!marks && !trace) return null;
  return (name, startMs, endMs) => {
    if (marks) emitPerfMeasure(name, startMs, endMs);
    if (trace) recordTraceEvent(name, startMs, endMs);
  };
}
