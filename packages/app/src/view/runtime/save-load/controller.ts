import { type ExportSaveOptions, type SaveGame, serializeSaveGame } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import type { SessionHost } from '../../../session/index.js';
import { compressSaveText, isGzipSave, type SaveBytes } from './codec.js';
import { evaluateSaveFile, type SaveRejection } from './evaluate.js';
import { browserSaveDownload, type PickedSaveFile, pickedSaveOf } from './file-access.js';
import { displayNameOf } from './list-model.js';
import { rootWorldId } from './related-world.js';
import { relaunchSearch } from './relaunch.js';
import type { SaveSlotInfo, SaveStore } from './store.js';

export type SaveOutcome = { kind: 'saved' } | { kind: 'failed' };

export type LoadOutcome =
  | { kind: 'loading' }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; reason: SaveRejection | 'storage' | 'missing' };

export interface SaveLoadDeps {
  readonly host: Pick<SessionHost, 'mapFingerprint' | 'content' | 'exportSave'>;
  /** The session's capture, with its accepted future input; absent, the host exports the world alone. */
  readonly captureSave?: (options: ExportSaveOptions) => SaveGame | Promise<SaveGame>;
  readonly parent?: SaveGame;
  readonly loadRelatedWorld?: (save: SaveGame, bytes: SaveBytes) => Promise<void>;
  /** The entry's world identity, exported as the save header's `mapId` and required to match on load. */
  readonly worldToken: string | null;
  /** The entry-selecting URL search, exported as the header's `entry` relaunch token. */
  readonly entrySearch: string | null;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
  /** Restart the page into the staged save; nothing after it runs in the surviving flow. */
  readonly reload: () => void;
  /** Stage save bytes for the reloaded boot, which resumes the world running when `resume` is set. */
  readonly stagePending: (bytes: SaveBytes, resume?: boolean) => Promise<void>;
  readonly pickFile: () => Promise<PickedSaveFile | null>;
  /** Hand save bytes to the user as a file download. */
  readonly downloadSave: (fileName: string, bytes: SaveBytes) => void;
  readonly store: SaveStore;
  readonly sessionMetadata?: () => unknown;
  readonly onSaved?: (save: SaveGame) => Promise<void>;
}

export interface SaveLoadSession {
  readonly worldToken: string | null;
  listSaves(): Promise<SaveSlotInfo[]>;
  /** Write the running game into the named slot, overwriting a same-named save. */
  saveGame(name: string): Promise<SaveOutcome>;
  /** Stage the running game for this page's next boot to pick up where it stands; no slot is written. */
  stageForReload(): Promise<void>;
  loadSave(id: string): Promise<LoadOutcome>;
  loadFromFile(): Promise<LoadOutcome>;
  /** Hand a stored save back out as a file download. */
  exportSave(id: string): Promise<SaveOutcome>;
  deleteSave(id: string): Promise<void>;
  /** Pause for the open system menu, remembering the player's own pause state. */
  forcePause(): void;
  /** Lift a forced pause, for menu-close paths where a browser never reports dialog dismissal. */
  releaseForcedPause(): void;
}

/**
 * The system menu's save and load flows. The pause belongs to the open menu, not the flows: the menu
 * forces it while visible and releases it on close, so a rejected or cancelled flow leaves the
 * running game exactly as it stood. A staged load reboots the page, where the restored session opens
 * paused on its own.
 */
export function saveLoadSession(deps: SaveLoadDeps): SaveLoadSession {
  const { host, worldToken } = deps;
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

  const captureRunning = async (): Promise<{ save: SaveGame; bytes: SaveBytes }> => {
    const capture = deps.captureSave ?? ((options: ExportSaveOptions) => host.exportSave(options));
    const save = await capture({
      savedAt: Date.now(),
      ...(deps.sessionMetadata === undefined ? {} : { session: deps.sessionMetadata() }),
      ...(deps.parent !== undefined ? { parent: deps.parent } : {}),
      ...(worldToken !== null ? { mapId: worldToken } : {}),
      ...(deps.entrySearch !== null ? { entry: deps.entrySearch } : {}),
    });
    return { save, bytes: await compressSaveText(serializeSaveGame(save)) };
  };

  const runLoad = async (pick: () => Promise<PickedSaveFile | null>): Promise<LoadOutcome> => {
    let picked: PickedSaveFile | null;
    try {
      picked = await pick();
    } catch (err) {
      // The player only ever sees the rejection reason, so the cause has to reach the log here.
      diag.warn('save', `reading the save to load failed: ${String(err)}`);
      return { kind: 'rejected', reason: 'corrupt' };
    }
    if (picked === null) return { kind: 'cancelled' };
    const evaluated = evaluateSaveFile(picked.contents, {
      worldToken,
      ...(deps.loadRelatedWorld !== undefined
        ? { rootWorldToken: deps.parent !== undefined ? rootWorldId(deps.parent) : worldToken }
        : {}),
      mapFingerprint: host.mapFingerprint ?? null,
      irVersion: host.content.manifest.version,
    });
    if (!evaluated.ok) return { kind: 'rejected', reason: evaluated.reason };
    // A save of this map played under another session (another seat or civilization) relaunches
    // through its own entry, as another map's does: the running search would assemble its world.
    const relaunch = relaunchSearch(evaluated.save.header);
    const elsewhere =
      evaluated.save.header.mapId !== worldToken || (relaunch !== null && relaunch !== deps.entrySearch);
    if (elsewhere && deps.loadRelatedWorld !== undefined) {
      try {
        await deps.loadRelatedWorld(evaluated.save, picked.raw);
        return { kind: 'loading' };
      } catch (err) {
        diag.warn('save', `related mission could not load: ${String(err)}`);
        return { kind: 'rejected', reason: 'wrongMap' };
      }
    }
    try {
      await deps.stagePending(picked.raw);
    } catch {
      return { kind: 'rejected', reason: 'storage' };
    }
    deps.reload();
    return { kind: 'loading' };
  };

  return {
    worldToken,

    listSaves: () => deps.store.list(),

    async saveGame(name: string): Promise<SaveOutcome> {
      try {
        const { save, bytes } = await captureRunning();
        await deps.store.write(name, bytes, {
          mapId: worldToken,
          tick: save.header.tick,
          entry: deps.entrySearch,
          savedAt: save.header.savedAt,
        });
        if (deps.onSaved !== undefined) {
          try {
            await deps.onSaved(save);
          } catch (error) {
            diag.warn('net', 'saved locally but relay snapshot upload failed', { error: String(error) });
          }
        }
        return { kind: 'saved' };
      } catch (err) {
        diag.warn('save', `writing slot ${JSON.stringify(name)} failed: ${String(err)}`);
        return { kind: 'failed' };
      }
    },

    async loadSave(id: string): Promise<LoadOutcome> {
      let bytes: SaveBytes | null;
      try {
        bytes = await deps.store.read(id);
      } catch (err) {
        // A store that threw still holds the slot: saying it is gone would invite deleting a live save.
        diag.warn('save', `reading slot ${JSON.stringify(id)} failed: ${String(err)}`);
        return { kind: 'rejected', reason: 'storage' };
      }
      if (bytes === null) return { kind: 'rejected', reason: 'missing' };
      const stored = bytes;
      return runLoad(() => pickedSaveOf(id, stored));
    },

    loadFromFile: () => runLoad(deps.pickFile),

    async exportSave(id: string): Promise<SaveOutcome> {
      try {
        const bytes = await deps.store.read(id);
        if (bytes === null) return { kind: 'failed' };
        deps.downloadSave(exportFileName(id, bytes), bytes);
        return { kind: 'saved' };
      } catch (err) {
        diag.warn('save', `exporting slot ${JSON.stringify(id)} failed: ${String(err)}`);
        return { kind: 'failed' };
      }
    },

    async stageForReload(): Promise<void> {
      // An open menu's pause is not the player's: the game resumes as it stood under the menu.
      const running = forced === null ? !deps.isPaused() : !forced.priorPaused;
      const { bytes } = await captureRunning();
      await deps.stagePending(bytes, running);
    },

    deleteSave: (id) => deps.store.remove(id),

    forcePause,
    releaseForcedPause,
  };
}

/** Suffix the exported file for the payload it actually carries; a slot name is whatever the player typed. */
function exportFileName(id: string, bytes: SaveBytes): string {
  return `${displayNameOf(id)}${isGzipSave(bytes) ? '.json.gz' : '.json'}`;
}

/** The menu screen's backup path over a stored slot: download the slot's bytes under its display name. */
export async function downloadStoredSave(store: SaveStore, id: string): Promise<'downloaded' | 'missing'> {
  const bytes = await store.read(id);
  if (bytes === null) return 'missing';
  browserSaveDownload(exportFileName(id, bytes), bytes);
  return 'downloaded';
}
