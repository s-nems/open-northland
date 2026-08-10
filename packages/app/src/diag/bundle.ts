/**
 * The diagnostics bundle a tester attaches to a bug report: replaying `commandLog` over the world
 * named by `entry` and `worldId` reproduces the session up to `tick`.
 */
import type { LoggedCommand } from '@open-northland/sim';
import { downloadJsonFile } from './download.js';
import { type DiagEntry, type DiagLog, diag } from './log.js';
import { currentDiagGameSession, type DiagGameSession } from './session.js';
import { recordedTraceEvents, type TraceEvent } from './trace.js';

export const DIAGNOSTICS_BUNDLE_KIND = 'opennorthland-diagnostics';
export const DIAGNOSTICS_BUNDLE_VERSION = 1;

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

export function buildDiagnosticsBundle(
  log: DiagLog = diag,
  session: DiagGameSession | null = currentDiagGameSession(),
  trace: readonly TraceEvent[] | null = recordedTraceEvents(),
): DiagnosticsBundle {
  return {
    kind: DIAGNOSTICS_BUNDLE_KIND,
    version: DIAGNOSTICS_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    log: log.entries(),
    game: session === null ? null : gameReport(session),
    ...(trace !== null ? { trace } : {}),
  };
}

function gameReport(session: DiagGameSession): DiagnosticsGameReport {
  const { sim } = session;
  // Hashing walks every component, so a wedged world may throw; a null hash must not lose the bundle.
  let finalHash: string | null = null;
  try {
    finalHash = sim.hashState();
  } catch {
    // A null hash still leaves a replayable command log.
  }
  return {
    entry: session.entry,
    worldId: session.worldId,
    seed: session.seed,
    tick: sim.tick,
    ...(session.restoredAtTick !== undefined && session.restoredAtTick !== null
      ? { restoredAtTick: session.restoredAtTick }
      : {}),
    finalHash,
    commandLog: sim.commands.log,
    ...(session.hashTrace !== null
      ? { hashes: session.hashTrace.list().map(({ tick, hash }) => ({ tick, hash })) }
      : {}),
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

export function downloadDiagnosticsBundle(bundle: DiagnosticsBundle = buildDiagnosticsBundle()): void {
  downloadJsonFile(
    `opennorthland-diagnostics-${bundle.generatedAt.replaceAll(':', '-')}.json`,
    serializeDiagnosticsBundle(bundle),
  );
}
