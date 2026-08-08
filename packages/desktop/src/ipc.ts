import type { GameFolderProbe } from '@open-northland/asset-pipeline';
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import type { ContentStatus } from './content-state.js';
import type { Locale } from './i18n/index.js';

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
} as const;

/** Channels the main process pushes to the renderer; every other one is invoked. */
export const SEND_ONLY_CHANNELS = [IPC_CHANNELS.pipelineEvent, IPC_CHANNELS.modEvent] as const;

export type IpcInvokeChannel = Exclude<
  (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS],
  (typeof SEND_ONLY_CHANNELS)[number]
>;

/** What the setup renderer needs to render its first screen. */
export interface DesktopState {
  /** Where `content/` and the config live; the precedence is `paths.ts`. */
  readonly dataRoot: string;
  readonly portable: boolean;
  /** The installer language: the persisted choice, else the detected OS locale. */
  readonly locale: Locale;
  /** How the installed content compares to this shell's pipeline. */
  readonly contentStatus: ContentStatus;
  /** The game folder remembered from a previous run, to prefill the picker. */
  readonly gamePath?: string;
  /** A usable culturesnation mod root outside the game folder, if any. */
  readonly modRoot?: string;
}

export interface GameFolderCandidate {
  readonly path: string;
  readonly probe: GameFolderProbe;
}

/** A picked save file's display name and full text; never a filesystem path. */
export interface SaveFileContents {
  readonly name: string;
  readonly contents: string;
}

export type PipelineEvent =
  | { readonly kind: 'stage'; readonly stage: PipelineStageId }
  | { readonly kind: 'item'; readonly done: number; readonly total?: number }
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };

export type ModEvent =
  | { readonly kind: 'mod-download'; readonly received: number; readonly total?: number }
  | { readonly kind: 'mod-extract'; readonly done: number; readonly total: number }
  | { readonly kind: 'mod-warning'; readonly message: string };

/** The API the preload bridge exposes to the setup renderer as `window.desktop`. */
export interface DesktopApi {
  getState(): Promise<DesktopState>;
  /** Native folder picker; `null` when the user cancels. */
  pickGameFolder(): Promise<GameFolderCandidate | null>;
  probeGamePath(path: string): Promise<GameFolderCandidate>;
  detectGameFolders(): Promise<GameFolderCandidate[]>;
  /** Start converting `gamePath` into the data root; progress arrives on `onPipelineEvent`. */
  runPipeline(gamePath: string): Promise<void>;
  /** Abort a running conversion; resolves once the child exited, without throwing. */
  stopPipeline(): Promise<void>;
  onPipelineEvent(listener: (event: PipelineEvent) => void): void;
  /** Install the culturesnation mod into the data root; resolves to its root path. */
  downloadMod(): Promise<string>;
  /** Abort a running mod download, rejecting its `downloadMod` promise. */
  cancelModDownload(): Promise<void>;
  /** Resolves to the validated mod root under the picked folder; `null` when the user cancels. */
  pickModFolder(): Promise<string | null>;
  onModEvent(listener: (event: ModEvent) => void): void;
  /** Swap the window from the setup page to the game. */
  startGame(): Promise<void>;
  /** Persist the installer language and re-localize the native menu. */
  setLocale(locale: Locale): Promise<void>;
  // The two file methods mirror the game page's structural `GameFileBridge`
  // (`packages/app/src/view/runtime/save-load/file-access.ts`).
  /** Native save dialog for a game save; resolves to the written file's basename, null on cancel. */
  saveGameFile(suggestedName: string, contents: string): Promise<string | null>;
  /** Native open dialog for a game save; null on cancel. */
  openGameFile(): Promise<SaveFileContents | null>;
}
