import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import type { ContentStatus } from './content-state.js';
import type { Locale } from './i18n/index.js';

/**
 * Where this shell gets the mod and what "I already have it" takes, which the page has to word for
 * the visitor: the desktop shell downloads from the mod's own site and adopts an unpacked folder,
 * the web shell fetches the archive its own origin hosts and adopts that zip.
 */
export type ModDelivery = 'upstream-folder' | 'origin-archive';

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
  readonly modDelivery: ModDelivery;
  /** A usable culturesnation mod root in the data root or hand-picked, if any. */
  readonly modRoot?: string;
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

export interface PipelineApi {
  /** Start converting the available mod root into the data root; progress arrives on
   *  `onPipelineEvent`. */
  runPipeline(): Promise<void>;
  /** Abort a running conversion; resolves once it stopped, without throwing. */
  stopPipeline(): Promise<void>;
  onPipelineEvent(listener: (event: PipelineEvent) => void): void;
}

export interface ModInstallApi {
  /** Install the culturesnation mod into the data root; resolves to its root path. */
  downloadMod(): Promise<string>;
  /** Abort a running mod download, rejecting its `downloadMod` promise. */
  cancelModDownload(): Promise<void>;
  /** Resolves to the validated mod root under a user-picked source; `null` when the user cancels. */
  pickModFolder(): Promise<string | null>;
  onModEvent(listener: (event: ModEvent) => void): void;
}

export interface ShellChromeApi {
  getState(): Promise<ShellSetupState>;
  /** Swap from the setup page to the game. */
  startGame(): Promise<void>;
  /** Persist the installer language and re-localize any shell chrome. */
  setLocale(locale: Locale): Promise<void>;
}

export type ShellApi = PipelineApi & ModInstallApi & ShellChromeApi;
