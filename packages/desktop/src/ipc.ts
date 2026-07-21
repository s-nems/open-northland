import type { GameFolderProbe } from '@open-northland/asset-pipeline';
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import type { ContentStatus } from './content-state.js';
import type { Locale } from './i18n/index.js';

/**
 * The desktop shell's IPC vocabulary — one shared module so the main process, the preload bridge,
 * the pipeline child, and the setup renderer agree on channel names and message shapes.
 */

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
} as const;

/** Channels the main process pushes to the renderer; every other channel is invoked and handled. */
export const SEND_ONLY_CHANNELS = [IPC_CHANNELS.pipelineEvent, IPC_CHANNELS.modEvent] as const;

export type IpcInvokeChannel = Exclude<
  (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS],
  (typeof SEND_ONLY_CHANNELS)[number]
>;

/** What the setup renderer needs to render its first screen. */
export interface DesktopState {
  /** Where `content/` + the config live: the portable dir, the per-user data dir, or the dev repo root. */
  readonly dataRoot: string;
  readonly portable: boolean;
  /** The active installer language (persisted choice, else the detected OS locale). */
  readonly locale: Locale;
  /** How the installed content compares to this shell's pipeline (see `content-state.ts`). */
  readonly contentStatus: ContentStatus;
  /** The game folder remembered from a previous run, to prefill the picker. */
  readonly gamePath?: string;
  /** A usable culturesnation mod root outside the game folder (downloaded or hand-picked), if any. */
  readonly modRoot?: string;
}

/** A candidate original-game folder: the path plus what the probe found there. */
export interface GameFolderCandidate {
  readonly path: string;
  readonly probe: GameFolderProbe;
}

/** Pipeline lifecycle events streamed to the setup renderer while the conversion runs. */
export type PipelineEvent =
  | { readonly kind: 'stage'; readonly stage: PipelineStageId }
  | { readonly kind: 'item'; readonly done: number; readonly total?: number }
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };

/** Mod download/extract progress streamed to the setup renderer (see `mod-install/`). */
export type ModEvent =
  | { readonly kind: 'mod-download'; readonly received: number; readonly total?: number }
  | { readonly kind: 'mod-extract'; readonly done: number; readonly total: number }
  | { readonly kind: 'mod-warning'; readonly message: string };

/** The `window.desktop` API the preload bridge exposes to the setup renderer. */
export interface DesktopApi {
  getState(): Promise<DesktopState>;
  /** Native folder picker; `null` when the user cancels. */
  pickGameFolder(): Promise<GameFolderCandidate | null>;
  /** Probe a hand-typed path. */
  probeGamePath(path: string): Promise<GameFolderCandidate>;
  /** Scan conventional install locations for likely game folders. */
  detectGameFolders(): Promise<GameFolderCandidate[]>;
  /** Start the conversion of `gamePath` into the data root; events arrive via {@link onPipelineEvent}. */
  runPipeline(gamePath: string): Promise<void>;
  /** Abort a running conversion (the wizard's Cancel); resolves after the child exited, silently. */
  stopPipeline(): Promise<void>;
  onPipelineEvent(listener: (event: PipelineEvent) => void): void;
  /** Download + install the culturesnation mod into the data root; resolves to the mod root. */
  downloadMod(): Promise<string>;
  /** Abort a running mod download (its downloadMod promise then rejects). */
  cancelModDownload(): Promise<void>;
  /** Native picker for a hand-downloaded mod folder; resolves to the validated mod root, or null. */
  pickModFolder(): Promise<string | null>;
  onModEvent(listener: (event: ModEvent) => void): void;
  /** Swap the window from the setup page to the game. */
  startGame(): Promise<void>;
  /** Persist the chosen installer language and re-localize the native menu; the renderer re-renders itself. */
  setLocale(locale: Locale): Promise<void>;
}
