import type { PipelineEvent } from '@open-northland/installer';
import type { FolderSnapshot } from '@open-northland/vfs/opfs';

/** Messages between the setup page and the pipeline worker; everything is structured-cloneable. */

export interface RunPipelineRequest {
  readonly kind: 'run';
  readonly game: FolderSnapshot;
  /** OPFS-relative mod root, or undefined when the mod sits inside the game folder. */
  readonly modRoot: string | undefined;
}

export type PipelineWorkerMessage = PipelineEvent;

/** Mount points the worker composes; the snapshot is read-only, OPFS carries the output. */
export const GAME_MOUNT = '/game';
export const DATA_MOUNT = '/data';
