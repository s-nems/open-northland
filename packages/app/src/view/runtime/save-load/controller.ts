import type { ExportSaveOptions, SaveGame } from '@open-northland/sim';
import { CLIENT_BUILD, GAME_VERSION } from '../../../build-version.js';
import { contentLobbyFingerprint } from '../../../content/lobby-identity.js';
import { diag } from '../../../diag/index.js';
import type { SessionHost } from '../../../session/index.js';
import { isGzipSave, type SaveBytes, type SaveFile, saveFileOf } from './codec.js';
import { evaluateSaveFile, type SaveRejection } from './evaluate.js';
import { browserSaveDownload, type PickedSaveFile, pickedSaveOf } from './file-access.js';
import { displayNameOf } from './list-model.js';
import { relaunchSearch } from './relaunch.js';
import type { ReplayCaptureFile, ReplayCaptureOptions } from './replay.js';
import { replaySlotKeyOf, replaySlotNameOf } from './replay.js';
import type { ReplaySlotInfo, ReplayStore } from './replay-store.js';
import type { SaveSlotInfo, SaveStore } from './store.js';
import type { SavedView } from './view-state.js';

export type SaveOutcome = { kind: 'saved' } | { kind: 'failed' };

export type LoadOutcome =
  | { kind: 'loading' }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; reason: SaveRejection | 'storage' | 'missing' };

export interface SaveLoadDeps {
  readonly host: Pick<SessionHost, 'mapFingerprint' | 'content' | 'exportSave'>;
  /** The session's capture, with its accepted future input; absent, the host exports the world alone. */
  readonly captureSave?: (options: ExportSaveOptions) => SaveGame | Promise<SaveGame>;
  /** The same capture as file bytes, produced where the sim runs; preferred over `captureSave`. */
  readonly captureSaveFile?: (options: ExportSaveOptions) => Promise<SaveFile>;
  /** The session's replay capture, produced where the sim runs; absent, the session keeps no replay. */
  readonly captureReplayFile?: (options: ReplayCaptureOptions) => Promise<ReplayCaptureFile>;
  /** The replay list the capture writes into; absent, nothing records a replay. */
  readonly replayStore?: ReplayStore;
  readonly parent?: SaveGame;
  /** Hand the page to the entry that boots `save`'s own session, staging `bytes` for it. */
  readonly loadOtherWorld: (save: SaveGame, bytes: SaveBytes) => Promise<void>;
  /** The entry's world identity, exported as the save header's `mapId`; a load of another relaunches. */
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
  /** The client's view state for the header; absent or null, the save records none. */
  readonly viewState?: () => SavedView | null;
  /** The client's presentation memory kept beside the sections; absent or null, the save records none. */
  readonly presentation?: () => string | null;
  /** The running world's seed, which names its playthrough; null when the entry does not know it. */
  readonly worldSeed?: number | null;
  /** When the running session began, which keys and names its replay slot; absent, the first capture
   *  stamps it, and the stamp holds for every later capture of the session. */
  readonly sessionStartedAt?: number;
  /** A small picture of the world for the save list; absent or null, the save lists without one. */
  readonly captureThumbnail?: () => Promise<Blob | null>;
}

export interface SaveLoadSession {
  readonly worldToken: string | null;
  /** With `worldToken`, the running playthrough (`SaveSlotInfo.seed`). */
  readonly worldSeed: number | null;
  /** Whether the session's replay can be captured, so the save window offers it. */
  readonly canSaveReplay: boolean;
  listSaves(): Promise<SaveSlotInfo[]>;
  /** Write the running game into the named slot, overwriting a same-named save. */
  saveGame(name: string): Promise<SaveOutcome>;
  /** Record the running session's replay into the replay store, under its auto name. */
  saveReplay(): Promise<SaveOutcome>;
  /** Every stored replay, newest first, for the menu's replay screen. */
  listReplays(): Promise<ReplaySlotInfo[]>;
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
  // One stamp per session, held from the first capture on: every capture of the session keys and
  // names its slot by it, so a later capture rewrites the same slot instead of adding one.
  let startedAt = deps.sessionStartedAt ?? null;
  const sessionStartedAt = (): number => {
    if (startedAt === null) startedAt = Date.now();
    return startedAt;
  };
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

  const captureRunning = async (): Promise<SaveFile> => {
    const options: ExportSaveOptions = {
      savedAt: Date.now(),
      ...(deps.sessionMetadata === undefined ? {} : { session: deps.sessionMetadata() }),
      ...(deps.viewState === undefined ? {} : { view: deps.viewState() }),
      ...(deps.presentation === undefined ? {} : { presentation: deps.presentation() }),
      ...(deps.parent !== undefined ? { parent: deps.parent } : {}),
      ...(worldToken !== null ? { mapId: worldToken } : {}),
      ...(deps.entrySearch !== null ? { entry: deps.entrySearch } : {}),
    };
    if (deps.captureSaveFile !== undefined) return deps.captureSaveFile(options);
    const capture = deps.captureSave ?? ((opts: ExportSaveOptions) => host.exportSave(opts));
    return saveFileOf(await capture(options));
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
      mapFingerprint: host.mapFingerprint ?? null,
      irVersion: host.content.manifest.version,
    });
    if (!evaluated.ok) return { kind: 'rejected', reason: evaluated.reason };
    // Another world's save, or this map's played under another session (another seat or
    // civilization), relaunches through its own entry: the running search would assemble this world.
    const relaunch = relaunchSearch(evaluated.save.header);
    const elsewhere =
      evaluated.save.header.mapId !== worldToken || (relaunch !== null && relaunch !== deps.entrySearch);
    if (elsewhere) {
      try {
        await deps.loadOtherWorld(evaluated.save, picked.raw);
        return { kind: 'loading' };
      } catch (err) {
        diag.warn('save', `the save's own world could not load: ${String(err)}`);
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

  /** A picture is a nicety: failing to take one never fails the save. */
  const captureThumbnail = async (): Promise<Blob | null> => {
    if (deps.captureThumbnail === undefined) return null;
    try {
      return await deps.captureThumbnail();
    } catch (err) {
      diag.warn('save', `save thumbnail failed: ${String(err)}`);
      return null;
    }
  };

  return {
    worldToken,
    worldSeed: deps.worldSeed ?? null,
    canSaveReplay: deps.captureReplayFile !== undefined && deps.replayStore !== undefined,

    listSaves: () => deps.store.list(),

    async saveGame(name: string): Promise<SaveOutcome> {
      try {
        // The world first: a shared clock may advance while the picture is taken.
        const file = await captureRunning();
        const thumbnail = await captureThumbnail();
        await deps.store.write(name, file.bytes, {
          mapId: worldToken,
          tick: file.header.tick,
          entry: deps.entrySearch,
          savedAt: file.header.savedAt,
          seed: file.header.seed,
          thumbnail,
        });
        return { kind: 'saved' };
      } catch (err) {
        diag.warn('save', `writing slot ${JSON.stringify(name)} failed: ${String(err)}`);
        return { kind: 'failed' };
      }
    },

    /** Record the running session's replay into the replay store, under its auto name. */
    async saveReplay(): Promise<SaveOutcome> {
      const capture = deps.captureReplayFile;
      const store = deps.replayStore;
      if (capture === undefined || store === undefined) return { kind: 'failed' };
      try {
        const at = sessionStartedAt();
        const file = await capture({
          savedAt: Date.now(),
          startedAt: at,
          irVersion: deps.host.content.manifest.version,
          identity: {
            clientBuild: CLIENT_BUILD,
            gameVersion: GAME_VERSION,
            contentFingerprint: contentLobbyFingerprint(deps.host.content),
          },
        });
        await store.write(replaySlotKeyOf(file.startedAt, file.seed), file.bytes, {
          name: replaySlotNameOf(file.mapId, file.startedAt),
          mapId: file.mapId,
          untilTick: file.untilTick,
          seed: file.seed,
          savedAt: file.savedAt,
          clientBuild: file.identity.clientBuild,
          gameVersion: file.identity.gameVersion,
        });
        return { kind: 'saved' };
      } catch (err) {
        diag.warn('save', `writing the session replay failed: ${String(err)}`);
        return { kind: 'failed' };
      }
    },

    listReplays: () => deps.replayStore?.list() ?? Promise.resolve([]),

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
