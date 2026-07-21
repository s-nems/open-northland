/**
 * The diagnostics bundle — the one file a tester attaches to a bug report. Because the sim is
 * deterministic and command-driven, the bundle is a full session repro: rebuild the world with the
 * same builder (`entry` + `worldId` name it — world setup is pre-tick-0 builder work, not commands),
 * drop the rebuilt sim's pending setup commands (the log already carries them), then
 * `stepReplaying(sim, commandLog, tick)` re-runs the tester's exact session tick by tick (the round
 * trip `test/diag-bundle.test.ts` pins). The rest (log ring, environment header, recorded hashes) is
 * context around that payload.
 *
 * A future save format can reuse this identity and command metadata, but must also persist state for a
 * practical load time (docs/tickets/features/save-load-game.md).
 */
import type { LoggedCommand } from '@open-northland/sim';
import { downloadJsonFile } from './download.js';
import { type DiagEntry, type DiagLog, diag } from './log.js';
import { currentDiagGameSession, type DiagGameSession } from './session.js';
import { recordedTraceEvents, type TraceEvent } from './trace.js';

export const DIAGNOSTICS_BUNDLE_KIND = 'opennorthland-diagnostics';
export const DIAGNOSTICS_BUNDLE_VERSION = 1;

/** The running game's repro payload — absent when no game session is registered (e.g. the menu). */
export interface DiagnosticsGameReport {
  readonly entry: 'map' | 'scene';
  readonly worldId: string | null;
  readonly seed: number;
  readonly tick: number;
  /** `hashState()` at bundle time — the replay target; `null` when hashing threw (a wedged sim). */
  readonly finalHash: string | null;
  /** The full command log — replaying it from `seed` reconstructs the session (`replay()`). */
  readonly commandLog: readonly LoggedCommand[];
  /** The recorded per-tick hash trace (`?debug=diag` runs only) for divergence localization. */
  readonly hashes?: readonly { readonly tick: number; readonly hash: string }[];
}

export interface DiagnosticsBundle {
  readonly kind: typeof DIAGNOSTICS_BUNDLE_KIND;
  readonly version: typeof DIAGNOSTICS_BUNDLE_VERSION;
  /** Wall-clock ISO timestamp — when the tester generated the report, for correlating with their story. */
  readonly generatedAt: string;
  readonly log: readonly DiagEntry[];
  readonly game: DiagnosticsGameReport | null;
  /** The Trace Event recording, attached when a `?debug=trace` run generates the bundle. */
  readonly trace?: readonly TraceEvent[];
}

/** Assemble the bundle from the log ring, the registered game session, and the trace recording. */
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
  // A crash bundle must survive a wedged sim: hashing walks every component, so a half-broken world
  // may throw — report `null` rather than losing the whole bundle.
  let finalHash: string | null = null;
  try {
    finalHash = sim.hashState();
  } catch {
    // finalHash stays null; the command log still replays.
  }
  return {
    entry: session.entry,
    worldId: session.worldId,
    seed: session.seed,
    tick: sim.tick,
    finalHash,
    commandLog: sim.commands.log,
    ...(session.hashTrace !== null
      ? { hashes: session.hashTrace.list().map(({ tick, hash }) => ({ tick, hash })) }
      : {}),
  };
}

/**
 * Make one free-form log `data` value JSON-proof: BigInts become strings, a re-visited object is cut
 * as `"[circular]"`, anything still unserializable becomes `"[unserializable]"`. Lossy on purpose —
 * and applied ONLY to log data: the game report (the replay payload) and the trace are serializable
 * by contract and must never be cut (a shared command sub-object stringified as `"[circular]"` would
 * corrupt the repro).
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

/** Trigger a browser download of the bundle as a standalone `.json` report file. */
export function downloadDiagnosticsBundle(bundle: DiagnosticsBundle = buildDiagnosticsBundle()): void {
  downloadJsonFile(
    `opennorthland-diagnostics-${bundle.generatedAt.replaceAll(':', '-')}.json`,
    serializeDiagnosticsBundle(bundle),
  );
}
