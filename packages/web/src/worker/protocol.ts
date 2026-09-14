import type { PipelineEvent } from '@open-northland/installer';
import type { Locale } from '@open-northland/installer/i18n';

/** Messages between the setup page and the pipeline worker; everything is structured-cloneable. */

export interface RunPipelineRequest {
  readonly kind: 'run';
  /** OPFS-root-relative mod root (`open-northland/mods/…`). */
  readonly modRoot: string;
  /** The page's installer language, so a failure raised inside the worker speaks it too. */
  readonly locale: Locale;
}

export type PipelineWorkerMessage = PipelineEvent;
