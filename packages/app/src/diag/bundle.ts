/**
 * The diagnostics bundle — the one file a tester attaches to a bug report. Because the sim is
 * deterministic and command-driven, the bundle is a full session repro: rebuild the world with the
 * same builder (`entry` + `worldId` name it — world setup is pre-tick-0 builder work, not commands),
 * drop the rebuilt sim's pending setup commands (the log already carries them), then
 * `stepReplaying(sim, commandLog, tick)` re-runs the tester's exact session tick by tick (the round
 * trip `test/diag-bundle.test.ts` pins). The rest (log ring, environment header, recorded hashes) is
 * context around that payload.
 *
 * The same shape is `{seed, contentVersion, map, commandLog}` territory as the future save format
 * (docs/tickets/features/save-load-game.md) — whichever lands a persisted format second reuses the
 * first's, so the two never drift.
 */
import type { LoggedCommand } from '@open-northland/sim';
import { type DiagEntry, type DiagLog, diag } from './log.js';
import { currentDiagGameSession, type DiagGameSession } from './session.js';

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
}

/** Assemble the bundle from the log ring and the registered game session. Pure given its inputs. */
export function buildDiagnosticsBundle(
  log: DiagLog = diag,
  session: DiagGameSession | null = currentDiagGameSession(),
): DiagnosticsBundle {
  return {
    kind: DIAGNOSTICS_BUNDLE_KIND,
    version: DIAGNOSTICS_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    log: log.entries(),
    game: session === null ? null : gameReport(session),
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
 * Serialize defensively: log `data` is normalized at log time, but a caller can still hand the ring
 * something exotic — a crash-path serializer must not throw. BigInts become strings; a re-visited
 * object is cut as `"[circular]"` (this also cuts merely-shared references — acceptable losiness for
 * a diagnostics artifact, never for a save).
 */
export function serializeDiagnosticsBundle(bundle: DiagnosticsBundle): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    bundle,
    (_key, value: unknown) => {
      if (typeof value === 'bigint') return String(value);
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    },
    2,
  );
}

/** Trigger a browser download of the bundle as a standalone `.json` report file. */
export function downloadDiagnosticsBundle(bundle: DiagnosticsBundle = buildDiagnosticsBundle()): void {
  const blob = new Blob([serializeDiagnosticsBundle(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `opennorthland-diagnostics-${bundle.generatedAt.replaceAll(':', '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
