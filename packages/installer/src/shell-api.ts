import type { GameFolderProbe } from '@open-northland/asset-pipeline';
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import type { ContentStatus } from './content-state.js';
import type { Locale } from './i18n/index.js';

/**
 * The seam between the shared first-run setup page and its hosting shell. The desktop shell
 * implements it over Electron IPC with native paths; the web shell over OPFS, dropped folders, and a
 * pipeline worker. Optional members double as capability flags: an absent `probeGamePath` hides the
 * typed-path input, an absent `detectGameFolders` the detected-installs list, an absent `handleDrop`
 * the drop zone.
 */

/** What the setup page needs to render its first screen. */
export interface ShellSetupState {
  /** Where the converted content lives, as a directory path; absent means the browser's
   *  origin-private storage, which the setup page words itself so a language switch re-words it. */
  readonly dataRootLabel?: string;
  readonly portable: boolean;
  /** The installer language: the persisted choice, else the detected environment locale. */
  readonly locale: Locale;
  /** How the installed content compares to this shell's pipeline. */
  readonly contentStatus: ContentStatus;
  /** The game folder remembered from a previous run, to prefill the picker. */
  readonly gamePath?: string;
  /** A usable culturesnation mod root outside the game folder, if any. */
  readonly modRoot?: string;
}

export interface GameFolderCandidate {
  /** Shell-meaningful identifier the UI displays and hands back to `runPipeline`. */
  readonly path: string;
  readonly probe: GameFolderProbe;
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

export interface ShellApi {
  getState(): Promise<ShellSetupState>;
  /** Shell folder picker; `null` when the user cancels. */
  pickGameFolder(): Promise<GameFolderCandidate | null>;
  /** Probe a hand-typed path; presence enables the typed-path input. */
  probeGamePath?(path: string): Promise<GameFolderCandidate>;
  /** Scan for known installs; presence enables the detected-installs list. */
  detectGameFolders?(): Promise<GameFolderCandidate[]>;
  /** Adopt a dropped game folder; presence enables the drop zone. `null` when nothing usable. */
  handleDrop?(transfer: DataTransfer): Promise<GameFolderCandidate | null>;
  /** Start converting `gamePath` into the data root; progress arrives on `onPipelineEvent`. */
  runPipeline(gamePath: string): Promise<void>;
  /** Abort a running conversion; resolves once it stopped, without throwing. */
  stopPipeline(): Promise<void>;
  onPipelineEvent(listener: (event: PipelineEvent) => void): void;
  /** Install the culturesnation mod into the data root; resolves to its root path. */
  downloadMod(): Promise<string>;
  /** Abort a running mod download, rejecting its `downloadMod` promise. */
  cancelModDownload(): Promise<void>;
  /** Resolves to the validated mod root under a user-picked source; `null` when the user cancels. */
  pickModFolder(): Promise<string | null>;
  onModEvent(listener: (event: ModEvent) => void): void;
  /** Swap from the setup page to the game. */
  startGame(): Promise<void>;
  /** Persist the installer language and re-localize any shell chrome. */
  setLocale(locale: Locale): Promise<void>;
}
