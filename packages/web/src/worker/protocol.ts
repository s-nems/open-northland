import type { PipelineEvent } from '@open-northland/installer';
import type { Locale } from '@open-northland/installer/i18n';
import { vjoin } from '@open-northland/vfs';
import type { FolderSnapshot } from '@open-northland/vfs/opfs';
import { CONTENT_DIR } from '../opfs-layout.js';

/** Messages between the setup page and the pipeline worker; everything is structured-cloneable. */

export interface RunPipelineRequest {
  readonly kind: 'run';
  readonly game: FolderSnapshot;
  /** OPFS-root-relative mod root (`open-northland/mods/…`), or undefined when the mod sits inside
   *  the game folder. */
  readonly modRoot: string | undefined;
  /** The page's installer language, so a failure raised inside the worker speaks it too. */
  readonly locale: Locale;
}

export type PipelineWorkerMessage = PipelineEvent;

/** Mount points the worker composes; the snapshot is read-only, OPFS carries the output. */
export const GAME_MOUNT = '/game';
export const DATA_MOUNT = '/data';

/** The pipeline invocation for a request, with every OPFS path re-rooted under the data mount. */
export function pipelineArgsOf(request: RunPipelineRequest): {
  readonly game: string;
  readonly out: string;
  readonly modRoot: string | undefined;
} {
  return {
    game: GAME_MOUNT,
    out: vjoin(DATA_MOUNT, CONTENT_DIR),
    modRoot: request.modRoot === undefined ? undefined : vjoin(DATA_MOUNT, request.modRoot),
  };
}
