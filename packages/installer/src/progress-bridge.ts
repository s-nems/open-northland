import type { PipelineProgress } from '@open-northland/asset-pipeline/progress';
import { createEventThrottle } from './event-throttle.js';
import type { PipelineEvent } from './shell-api.js';

/**
 * Shapes raw pipeline progress into throttled {@link PipelineEvent}s for a shell's event channel.
 * Known-total stages tick at item start, so `total - 1` is the last tick and must always pass.
 */
export function bridgePipelineProgress(post: (event: PipelineEvent) => void): PipelineProgress {
  const itemThrottle = createEventThrottle();
  return {
    stage(stage) {
      itemThrottle.reset();
      post({ kind: 'stage', stage });
    },
    item(done, total) {
      const lastOfStage = total !== undefined && done >= total - 1;
      if (!itemThrottle.shouldEmit(lastOfStage)) return;
      post(total === undefined ? { kind: 'item', done } : { kind: 'item', done, total });
    },
  };
}
