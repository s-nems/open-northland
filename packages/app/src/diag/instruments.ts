/**
 * `Simulation.setInstrument` has a single slot, so every consumer of the per-system seam is fanned
 * out from this one installer.
 */
import type { Simulation } from '@open-northland/sim';
import { hasDebugFlag } from './debug-flags.js';
import { emitPerfMeasure, PERF_MARKS_DEBUG_FLAG } from './perf-marks.js';
import { PROFILE_DEBUG_FLAG, SystemProfile } from './system-profile.js';
import { recordTraceEvent, startTraceRecording, TRACE_DEBUG_FLAG } from './trace.js';

/** Emits one named interval to every consumer the active flags asked for. */
export type PhaseEmitter = (name: string, startMs: number, endMs: number) => void;

/** With no `?debug=` flag set nothing is installed, so an ordinary session keeps the sim's direct call. */
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
