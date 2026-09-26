/** The running game's diagnostics identity; the view that registers it clears it when it closes. */
import { HashTrace, type SyncDomain } from '@open-northland/sim';
import type { SessionHost } from '../session/index.js';
import { hasDebugFlag } from './debug-flags.js';
import { diag } from './log.js';

/** What a relayed session adds to a bundle: where the relay said this client parted from the room,
 *  and the digests it acknowledged around there. */
export interface DiagNetReport {
  readonly desync: {
    readonly tick: number;
    readonly domains: readonly SyncDomain[];
    readonly reference: string;
  } | null;
  readonly digests: readonly {
    readonly tick: number;
    readonly digest: Readonly<Record<SyncDomain, number>>;
  }[];
  readonly delayTicks: number | null;
  readonly roundTripMs: number | null;
}

export interface DiagGameSession {
  readonly entry: 'map' | 'scene';
  /** The map/scene id; decoded map bytes never ship in a bundle. */
  readonly worldId: string | null;
  readonly seed: number;
  /** The tick a restored session started from, so a bundle is not read as a run from tick 0; null
   *  for a world that booted fresh. */
  readonly restoredAtTick?: number | null;
  readonly host: SessionHost;
  /** State-hash ring when `?debug=diag` recording is on; `null` otherwise. */
  readonly hashTrace: HashTrace | null;
  /** The relayed session's report at bundle time; absent in a local session. */
  readonly net?: () => DiagNetReport;
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
 * The ticks between invariant checks, on hash-trace ticks. `checkInvariants()` re-derives every cache:
 * measured at about 100 ms against a 20 ms tick on the six-AI magiczny_las world at tick 40000, so
 * checking on every hash would add a quarter to the tick cost; every sixth adds about 4%.
 */
export const INVARIANT_CHECK_EVERY_TICKS = 120;

/** What the diag trace reads on a tick, or null for a tick it skips. */
export interface DiagCadence {
  readonly invariants: boolean;
}

export function diagCadenceAt(tick: number): DiagCadence | null {
  if (tick % HASH_TRACE_EVERY_TICKS !== 0) return null;
  return { invariants: tick % INVARIANT_CHECK_EVERY_TICKS === 0 };
}

/**
 * Record the delivered tick's state hash on the diag cadence, once it lands, and log the invariant
 * violations it found at error level. No-op when `host` is not the registered session's host, so a
 * stale registration cannot taint another world's trace. Observational only: a violation raises no
 * banner.
 */
export function recordTickDiagnostics(host: Pick<SessionHost, 'tick' | 'tickDiagnostics'>): void {
  const trace = current !== null && current.host === host ? current.hashTrace : null;
  const tick = host.tick;
  if (trace === null || diagCadenceAt(tick) === null) return;
  void host.tickDiagnostics().then(({ hash, violations }) => {
    trace.record(tick, hash);
    if (violations !== null && violations.length > 0) {
      diag.error('sim', `invariant violations at tick ${tick}`, { tick, violations });
    }
  });
}

export function hashTraceFor(params: URLSearchParams): HashTrace | null {
  return hasDebugFlag(params, HASH_TRACE_DEBUG_FLAG) ? new HashTrace() : null;
}
