import type { ShellApi } from '@open-northland/installer';

export const IPC_CHANNELS = {
  getState: 'desktop:get-state',
  pickGameFolder: 'desktop:pick-game-folder',
  probeGamePath: 'desktop:probe-game-path',
  detectGameFolders: 'desktop:detect-game-folders',
  runPipeline: 'desktop:run-pipeline',
  stopPipeline: 'desktop:stop-pipeline',
  pipelineEvent: 'desktop:pipeline-event',
  startGame: 'desktop:start-game',
  downloadMod: 'desktop:download-mod',
  cancelModDownload: 'desktop:cancel-mod-download',
  pickModFolder: 'desktop:pick-mod-folder',
  modEvent: 'desktop:mod-event',
  setLocale: 'desktop:set-locale',
  saveGameFile: 'desktop:save-game-file',
  openGameFile: 'desktop:open-game-file',
  listSaves: 'desktop:list-saves',
  readSave: 'desktop:read-save',
  writeSave: 'desktop:write-save',
  deleteSave: 'desktop:delete-save',
  showSavesFolder: 'desktop:show-saves-folder',
} as const;

/** Channels the main process pushes to the renderer; every other one is invoked. */
export const SEND_ONLY_CHANNELS = [IPC_CHANNELS.pipelineEvent, IPC_CHANNELS.modEvent] as const;

export type IpcInvokeChannel = Exclude<
  (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS],
  (typeof SEND_ONLY_CHANNELS)[number]
>;

/** A picked save file's display name and raw bytes; never a filesystem path. */
export interface SaveFileBytes {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** One save in the saves folder: the basename, the file mtime in ms, and the leading bytes the
 *  renderer peeks the save header from. */
export interface ListedSaveFile {
  readonly file: string;
  readonly savedAt: number;
  readonly prefix: Uint8Array;
}

/** Native save-file access, mirroring the game page's structural bridges `GameFileBridge` and
 *  `SaveListBridge` (`packages/app/src/view/runtime/save-load/`). */
export interface DesktopSaveApi {
  /** Native save dialog for a game save; resolves to the written file's basename, null on cancel. */
  saveGameFile(suggestedName: string, contents: Uint8Array): Promise<string | null>;
  /** Native open dialog for a game save; null on cancel. */
  openGameFile(): Promise<SaveFileBytes | null>;
  /** Every save file in the saves folder, unordered; empty when the folder does not exist yet. */
  listSaves(): Promise<ListedSaveFile[]>;
  /** A listed file's bytes; null when it vanished since the listing. */
  readSave(file: string): Promise<Uint8Array | null>;
  /** Write `<name>.json.gz` into the saves folder, overwriting a same-named save. */
  writeSave(name: string, bytes: Uint8Array): Promise<void>;
  deleteSave(file: string): Promise<void>;
  /** Reveal the saves folder in the OS file manager, creating it first. */
  showSavesFolder(): Promise<void>;
}

/** The shared setup contract plus the desktop-only save bridges, implemented by the preload bridge
 *  as `window.desktop`. The desktop shell serves typed paths and install detection; folder drops
 *  stay a web-shell affordance. */
export type DesktopApi = Required<Omit<ShellApi, 'handleDrop'>> &
  Pick<ShellApi, 'handleDrop'> &
  DesktopSaveApi;
