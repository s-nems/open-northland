export {
  buildDiagnosticsBundle,
  DIAGNOSTICS_BUNDLE_KIND,
  DIAGNOSTICS_BUNDLE_VERSION,
  type DiagnosticsBundle,
  type DiagnosticsGameReport,
  downloadDiagnosticsBundle,
  serializeDiagnosticsBundle,
} from './bundle.js';
export { installCrashCapture } from './crash.js';
export { debugFlags, hasDebugFlag, setDebugFlag } from './debug-flags.js';
export { downloadFile, downloadJsonFile } from './download.js';
export { logBootHeader } from './env-header.js';
export {
  type FrameDistribution,
  type FrameEma,
  type FrameSample,
  FrameStats,
  type FrameStatsReport,
} from './frame-stats.js';
export { heapMb } from './heap.js';
export { framePhaseEmitter, installSessionInstruments, type PhaseEmitter } from './instruments.js';
export {
  type ConsoleSink,
  type DiagEntry,
  type DiagLevel,
  DiagLog,
  type DiagLogOptions,
  diag,
} from './log.js';
export { emitPerfMeasure, PERF_MARKS_DEBUG_FLAG } from './perf-marks.js';
export {
  currentDiagGameSession,
  type DiagGameSession,
  HASH_TRACE_DEBUG_FLAG,
  HASH_TRACE_EVERY_TICKS,
  hashTraceFor,
  recordDiagHash,
  setDiagGameSession,
} from './session.js';
export { PROFILE_DEBUG_FLAG, SystemProfile, type SystemProfileRow } from './system-profile.js';
export {
  downloadTraceFile,
  isTraceRecording,
  recordedTraceEvents,
  recordTraceEvent,
  startTraceRecording,
  stopTraceRecording,
  TRACE_CAPACITY,
  TRACE_DEBUG_FLAG,
  type TraceEvent,
  traceFileJson,
} from './trace.js';
