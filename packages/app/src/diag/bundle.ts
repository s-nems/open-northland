/**
 * The diagnostics bundle a tester attaches to a bug report: replaying `commandLog` over the world
 * named by `entry` and `worldId` reproduces the session up to `tick`.
 */
import type { LoggedCommand } from '@open-northland/sim';
import { WORKER_STALL_TIMEOUT_MS } from '../session/worker/stall-watch.js';
import { downloadJsonFile } from './download.js';
import { type DiagEntry, type DiagLog, diag } from './log.js';
import { currentDiagGameSession, type DiagGameSession, type DiagNetReport } from './session.js';
import { recordedTraceEvents, type TraceEvent } from './trace.js';

export const DIAGNOSTICS_BUNDLE_KIND = 'opennorthland-diagnostics';
export const DIAGNOSTICS_BUNDLE_VERSION = 3;

/** The running game's repro payload, absent when no game session is registered. */
export interface DiagnosticsGameReport {
  readonly entry: 'map' | 'scene';
  readonly worldId: string | null;
  readonly seed: number;
  readonly tick: number;
  /** Set when the session was restored from a save: the command log covers only the ticks after it,
   *  so a replay from tick 0 cannot reproduce `finalHash`. */
  readonly restoredAtTick?: number;
  /** `hashState()` at bundle time, the replay target; `null` when hashing threw on a wedged sim. */
  readonly finalHash: string | null;
  readonly commandLog: readonly LoggedCommand[];
  /** The hash trace recorded in `?debug=diag` runs only, for divergence localization. */
  readonly hashes?: readonly { readonly tick: number; readonly hash: string }[];
  /** A relayed session's desync notice, acknowledged digests and last verdict with its fold inputs. */
  readonly net?: DiagNetReport;
}

export interface DiagnosticsBundle {
  readonly kind: typeof DIAGNOSTICS_BUNDLE_KIND;
  readonly version: typeof DIAGNOSTICS_BUNDLE_VERSION;
  /** Wall-clock ISO timestamp of generation. */
  readonly generatedAt: string;
  readonly log: readonly DiagEntry[];
  readonly game: DiagnosticsGameReport | null;
  /** The Trace Event recording, attached when a `?debug=trace` run generates the bundle. */
  readonly trace?: readonly TraceEvent[];
}

export async function buildDiagnosticsBundle(
  log: DiagLog = diag,
  session: DiagGameSession | null = currentDiagGameSession(),
  trace: readonly TraceEvent[] | null = recordedTraceEvents(),
): Promise<DiagnosticsBundle> {
  const generatedAt = new Date().toISOString();
  const entries = log.entries();
  return {
    kind: DIAGNOSTICS_BUNDLE_KIND,
    version: DIAGNOSTICS_BUNDLE_VERSION,
    generatedAt,
    log: entries,
    game: session === null ? null : await gameReport(session),
    ...(trace !== null ? { trace } : {}),
  };
}

/** How long the report waits for a host's answer: a worker silent this long counts as stalled. */
export const REPORT_ANSWER_TIMEOUT_MS = WORKER_STALL_TIMEOUT_MS;

/** The answer, or null when it failed or did not land within `timeoutMs`. */
export function answeredWithin<T>(
  answer: Promise<T>,
  timeoutMs = REPORT_ANSWER_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    answer.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function gameReport(session: DiagGameSession): Promise<DiagnosticsGameReport> {
  const { host } = session;
  // Hashing walks every component, so a wedged world may throw, and a stalled worker never answers; a
  // null hash must not lose the bundle, whose log and hash trace this thread holds.
  const hashed = await answeredWithin(host.hashState());
  const tick = hashed?.tick ?? host.tick;
  // Asked after the hash, so the log holds every command up to the hashed tick; a sim on another
  // thread may have applied more since, which a replay to that tick must not see.
  const log = await answeredWithin(host.commandLog());
  const commandLog = (log ?? []).filter((entry) => entry.applyTick <= tick);
  const finalHash = hashed?.hash ?? null;
  const net = session.net === undefined ? null : await answeredWithin(session.net());
  return {
    entry: session.entry,
    worldId: session.worldId,
    seed: session.seed,
    tick,
    ...(session.restoredAtTick !== undefined && session.restoredAtTick !== null
      ? { restoredAtTick: session.restoredAtTick }
      : {}),
    finalHash,
    commandLog,
    ...(session.hashTrace !== null
      ? { hashes: session.hashTrace.list().map(({ tick, hash }) => ({ tick, hash })) }
      : {}),
    ...(net !== null ? { net } : {}),
  };
}

/**
 * Make one free-form log `data` value JSON-proof. Lossy, so it applies only to log data: cutting a
 * shared sub-object of the game report or the trace as `"[circular]"` would corrupt the repro.
 */
function jsonSafeData(data: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(data, (_key, value: unknown) => {
      if (typeof value === 'bigint') return String(value);
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    });
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return '[unserializable]';
  }
}

/** Serialize for download: exact `game`/`trace` payloads, defensively-sanitized log `data`. */
export function serializeDiagnosticsBundle(bundle: DiagnosticsBundle): string {
  const log = bundle.log.map((e) => (e.data === undefined ? e : { ...e, data: jsonSafeData(e.data) }));
  return JSON.stringify({ ...bundle, log }, null, 2);
}

export async function downloadDiagnosticsBundle(bundle?: DiagnosticsBundle): Promise<void> {
  const built = bundle ?? (await buildDiagnosticsBundle());
  downloadJsonFile(
    `opennorthland-diagnostics-${built.generatedAt.replaceAll(':', '-')}.json`,
    serializeDiagnosticsBundle(built),
  );
}
