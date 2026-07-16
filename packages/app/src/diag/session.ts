/**
 * The current game's diagnostics identity — the facts a bundle needs that only the running session
 * knows (which sim, which world, which seed). A playable entry registers it when its sim exists;
 * quit-to-menu is a full page navigation (see game-view.ts), so module state resets with the page
 * and no explicit clearing is needed.
 */
import { HashTrace, type Simulation } from '@open-northland/sim';

export interface DiagGameSession {
  readonly entry: 'map' | 'scene';
  /** The map/scene id — enough for a dev to reload the same world; decoded map bytes never ship. */
  readonly worldId: string | null;
  readonly seed: number;
  readonly sim: Simulation;
  /** Per-tick state-hash ring when `?debug=diag` recording is on; `null` otherwise. */
  readonly hashTrace: HashTrace | null;
}

/**
 * Hash-recording cadence in ticks. `hashState()` walks the whole world, so per-tick recording is not
 * scale-free even behind the debug flag; a fixed cadence keeps the cost bounded and still lets two
 * runs' traces align (0 A.D. full-hashes every 20 turns — the same tradeoff).
 */
export const HASH_TRACE_EVERY_TICKS = 20;

let current: DiagGameSession | null = null;

/** Register the running game (a playable entry calls this once its sim exists). */
export function setDiagGameSession(session: DiagGameSession | null): void {
  current = session;
}

export function currentDiagGameSession(): DiagGameSession | null {
  return current;
}

/**
 * Record the stepped sim's state hash into the session's trace on the {@link HASH_TRACE_EVERY_TICKS}
 * cadence — the frame loop calls this after each `step()`. No-op when recording is off or `sim` is
 * not the registered session's sim (a stale registration must never taint another sim's trace).
 */
export function recordDiagHash(sim: Simulation): void {
  const trace = current !== null && current.sim === sim ? current.hashTrace : null;
  if (trace === null || sim.tick % HASH_TRACE_EVERY_TICKS !== 0) return;
  trace.record(sim.tick, sim.hashState());
}

/** Build the session's `HashTrace` when the `?debug=diag` flag asks for hash recording. */
export function hashTraceFor(params: URLSearchParams): HashTrace | null {
  return params.get('debug') === 'diag' ? new HashTrace() : null;
}
