import type { GameFolderProbe } from '@open-northland/asset-pipeline';
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import type { ContentStatus } from './content-state.js';

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
} as const;

/** What the setup renderer needs to render its first screen. */
export interface DesktopState {
  /** Where `content/` + the config live: the portable dir, the per-user data dir, or the dev repo root. */
  readonly dataRoot: string;
  readonly portable: boolean;
  /** How the installed content compares to this shell's pipeline (see `content-state.ts`). */
  readonly contentStatus: ContentStatus;
  /** The game folder remembered from a previous run, to prefill the picker. */
  readonly gamePath?: string;
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
  /** Swap the window from the setup page to the game. */
  startGame(): Promise<void>;
}
