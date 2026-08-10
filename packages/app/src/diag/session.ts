/**
 * The running game's diagnostics identity. Quit to menu is a full page navigation, so this module
 * state resets with the page and never needs explicit clearing.
 */
import { HashTrace, type Simulation } from '@open-northland/sim';
import { hasDebugFlag } from './debug-flags.js';

export interface DiagGameSession {
  readonly entry: 'map' | 'scene';
  /** The map/scene id; decoded map bytes never ship in a bundle. */
  readonly worldId: string | null;
  readonly seed: number;
  /** The tick a restored session started from, so a bundle is not read as a run from tick 0; null
   *  for a world that booted fresh. */
  readonly restoredAtTick?: number | null;
  readonly sim: Simulation;
  /** State-hash ring when `?debug=diag` recording is on; `null` otherwise. */
  readonly hashTrace: HashTrace | null;
}

/**
 * Hash-recording cadence in ticks. `hashState()` walks the whole world, so a fixed cadence keeps the
 * cost bounded and still lets two runs' traces align (0 A.D. full-hashes every 20 turns).
 */
export const HASH_TRACE_EVERY_TICKS = 20;

/** The `?debug=` value that turns hash recording on. */
export const HASH_TRACE_DEBUG_FLAG = 'diag';

let current: DiagGameSession | null = null;

export function setDiagGameSession(session: DiagGameSession | null): void {
  current = session;
}

export function currentDiagGameSession(): DiagGameSession | null {
  return current;
}

/**
 * Record the stepped sim's state hash on the HASH_TRACE_EVERY_TICKS cadence. No-op when `sim` is not
 * the registered session's sim, so a stale registration cannot taint another sim's trace.
 */
export function recordDiagHash(sim: Simulation): void {
  const trace = current !== null && current.sim === sim ? current.hashTrace : null;
  if (trace === null || sim.tick % HASH_TRACE_EVERY_TICKS !== 0) return;
  trace.record(sim.tick, sim.hashState());
}

export function hashTraceFor(params: URLSearchParams): HashTrace | null {
  return hasDebugFlag(params, HASH_TRACE_DEBUG_FLAG) ? new HashTrace() : null;
}
