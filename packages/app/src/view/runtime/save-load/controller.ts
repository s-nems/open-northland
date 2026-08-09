import { exportSaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { compressSaveText, type SaveBytes } from './codec.js';
import { evaluateSaveFile, type SaveRejection } from './evaluate.js';
import type { PickedSaveFile } from './file-access.js';

export type SaveOutcome = { kind: 'saved' } | { kind: 'cancelled' } | { kind: 'failed' };

export type LoadOutcome =
  | { kind: 'loading' }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; reason: SaveRejection | 'storage' };

export interface SaveLoadDeps {
  readonly sim: Simulation;
  /** The entry's world identity, exported as the save header's `mapId` and required to match on load. */
  readonly worldToken: string | null;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
  /** Restart the page into the staged save; nothing after it runs in the surviving flow. */
  readonly reload: () => void;
  /** Stage a validated file's bytes for the reloaded boot. */
  readonly stagePending: (bytes: SaveBytes) => Promise<void>;
  readonly pickFile: () => Promise<PickedSaveFile | null>;
  /** Hand gzipped save bytes to the user: a browser download or the desktop save dialog. */
  readonly deliverSave: (fileName: string, bytes: SaveBytes) => Promise<SaveOutcome>;
}

export interface SaveLoadSession {
  saveGame(): Promise<SaveOutcome>;
  loadGame(): Promise<LoadOutcome>;
  /** Lift a pause a flow forced, for menu-close paths where a browser never reports dialog dismissal. */
  releaseForcedPause(): void;
}

/**
 * The system menu's save and load flows. Both force-pause the loop for their dialog and restore the
 * player's own pause state on every exit that keeps the session; a load that stages its file reloads
 * the page instead, and a rejected or cancelled one changes nothing.
 */
export function saveLoadSession(deps: SaveLoadDeps): SaveLoadSession {
  const { sim, worldToken } = deps;
  let forced: { priorPaused: boolean } | null = null;
  const forcePause = (): void => {
    if (forced !== null) return;
    forced = { priorPaused: deps.isPaused() };
    deps.setPaused(true);
  };
  const releaseForcedPause = (): void => {
    if (forced === null) return;
    deps.setPaused(forced.priorPaused);
    forced = null;
  };

  return {
    async saveGame(): Promise<SaveOutcome> {
      forcePause();
      try {
        const save = exportSaveGame(sim, worldToken !== null ? { mapId: worldToken } : {});
        const bytes = await compressSaveText(serializeSaveGame(save));
        return await deps.deliverSave(saveFileName(worldToken, sim.tick), bytes);
      } catch {
        return { kind: 'failed' };
      } finally {
        releaseForcedPause();
      }
    },

    async loadGame(): Promise<LoadOutcome> {
      forcePause();
      let navigating = false;
      try {
        let picked: PickedSaveFile | null;
        try {
          picked = await deps.pickFile();
        } catch {
          return { kind: 'rejected', reason: 'corrupt' };
        }
        if (picked === null) return { kind: 'cancelled' };
        const evaluated = evaluateSaveFile(picked.contents, {
          worldToken,
          mapFingerprint: sim.mapFingerprint ?? null,
          irVersion: sim.content.manifest.version,
        });
        if (!evaluated.ok) return { kind: 'rejected', reason: evaluated.reason };
        try {
          await deps.stagePending(picked.raw);
        } catch {
          return { kind: 'rejected', reason: 'storage' };
        }
        navigating = true;
        deps.reload();
        return { kind: 'loading' };
      } finally {
        if (!navigating) releaseForcedPause();
      }
    },

    releaseForcedPause,
  };
}

function saveFileName(worldToken: string | null, tick: number): string {
  const world = (worldToken ?? 'world').replace(/[^a-z0-9-]+/gi, '-');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `open-northland-${world}-tick${tick}-${stamp}.json.gz`;
}
