import { exportSaveGame, type Simulation, serializeSaveGame } from '@open-northland/sim';
import { compressSaveText, isGzipSave, type SaveBytes } from './codec.js';
import { evaluateSaveFile, type SaveRejection } from './evaluate.js';
import { browserSaveDownload, type PickedSaveFile, pickedSaveOf } from './file-access.js';
import { displayNameOf } from './list-model.js';
import type { SaveSlotInfo, SaveStore } from './store.js';

export type SaveOutcome = { kind: 'saved' } | { kind: 'cancelled' } | { kind: 'failed' };

export type LoadOutcome =
  | { kind: 'loading' }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; reason: SaveRejection | 'storage' | 'missing' };

export interface SaveLoadDeps {
  readonly sim: Simulation;
  /** The entry's world identity, exported as the save header's `mapId` and required to match on load. */
  readonly worldToken: string | null;
  /** The entry-selecting URL search, exported as the header's `entry` relaunch token. */
  readonly entrySearch: string | null;
  readonly setPaused: (paused: boolean) => void;
  readonly isPaused: () => boolean;
  /** Restart the page into the staged save; nothing after it runs in the surviving flow. */
  readonly reload: () => void;
  /** Stage a validated file's bytes for the reloaded boot. */
  readonly stagePending: (bytes: SaveBytes) => Promise<void>;
  readonly pickFile: () => Promise<PickedSaveFile | null>;
  /** Hand save bytes to the user as a file: a browser download or the desktop save dialog. */
  readonly deliverSave: (fileName: string, bytes: SaveBytes) => Promise<SaveOutcome>;
  readonly store: SaveStore;
}

export interface SaveLoadSession {
  readonly worldToken: string | null;
  listSaves(): Promise<SaveSlotInfo[]>;
  /** Write the running game into the named slot, overwriting a same-named save. */
  saveGame(name: string): Promise<SaveOutcome>;
  loadSave(id: string): Promise<LoadOutcome>;
  loadFromFile(): Promise<LoadOutcome>;
  /** Hand a stored save back out as a file download or dialog. */
  exportSave(id: string): Promise<SaveOutcome>;
  deleteSave(id: string): Promise<void>;
  /** Reveal the desktop saves folder; null where no such folder exists. */
  readonly showFolder: (() => Promise<void>) | null;
  /** Pause for the open system menu, remembering the player's own pause state. */
  forcePause(): void;
  /** Lift a forced pause, for menu-close paths where a browser never reports dialog dismissal. */
  releaseForcedPause(): void;
}

/**
 * The system menu's save and load flows. The pause belongs to the open menu, not the flows: the
 * menu forces it while visible and releases it on close, so a load that stages its file reloads
 * the page still paused, and a rejected or cancelled flow changes nothing.
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

  const runLoad = async (pick: () => Promise<PickedSaveFile | null>): Promise<LoadOutcome> => {
    let picked: PickedSaveFile | null;
    try {
      picked = await pick();
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
    deps.reload();
    return { kind: 'loading' };
  };

  return {
    worldToken,

    listSaves: () => deps.store.list(),

    async saveGame(name: string): Promise<SaveOutcome> {
      try {
        const save = exportSaveGame(sim, {
          ...(worldToken !== null ? { mapId: worldToken } : {}),
          ...(deps.entrySearch !== null ? { entry: deps.entrySearch } : {}),
        });
        const bytes = await compressSaveText(serializeSaveGame(save));
        await deps.store.write(name, bytes, {
          mapId: worldToken,
          tick: sim.tick,
          entry: deps.entrySearch,
        });
        return { kind: 'saved' };
      } catch {
        return { kind: 'failed' };
      }
    },

    async loadSave(id: string): Promise<LoadOutcome> {
      const bytes = await deps.store.read(id).catch(() => null);
      if (bytes === null) return { kind: 'rejected', reason: 'missing' };
      return runLoad(() => pickedSaveOf(id, bytes));
    },

    loadFromFile: () => runLoad(deps.pickFile),

    async exportSave(id: string): Promise<SaveOutcome> {
      try {
        const bytes = await deps.store.read(id);
        if (bytes === null) return { kind: 'failed' };
        return await deps.deliverSave(exportFileName(id, bytes), bytes);
      } catch {
        return { kind: 'failed' };
      }
    },

    deleteSave: (id) => deps.store.remove(id),

    showFolder: deps.store.showFolder,

    forcePause,
    releaseForcedPause,
  };
}

/** Suffix the exported file for the payload it actually carries: a desktop slot id arrives as a
 *  suffixed basename, a browser slot name is whatever the player typed. */
function exportFileName(id: string, bytes: SaveBytes): string {
  return `${displayNameOf(id)}${isGzipSave(bytes) ? '.json.gz' : '.json'}`;
}

/** The browser backup path over a stored slot, shared by the menu screen and `deliverSave`'s
 *  wiring: download the slot's bytes under its display name. */
export async function downloadStoredSave(store: SaveStore, id: string): Promise<'downloaded' | 'missing'> {
  const bytes = await store.read(id);
  if (bytes === null) return 'missing';
  browserSaveDownload(exportFileName(id, bytes), bytes);
  return 'downloaded';
}
