/**
 * The pipeline's progress seam for an embedding host. Reporting is best-effort telemetry: reporters
 * must not throw, and stages ignore the seam entirely when absent.
 */

/** Stage ids in `runPipeline`'s fixed execution order. */
export const PIPELINE_STAGES = [
  'unpack',
  'pictures',
  'atlases',
  'player-colors',
  'gui',
  'fonts',
  'goods',
  'ir',
  'transitions',
  'maps',
  'music',
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

/**
 * Per-item heartbeat within the current stage: `done` items so far, `total` only when the stage knows
 * its item count up front. Known-total stages tick at item start (the final tick is `total - 1`) and
 * walk-as-you-go stages tick after each write, so no closing `done === total` tick is guaranteed.
 */
export type StageItemReporter = (done: number, total?: number) => void;

/** Progress callbacks for `runPipeline`; `item` ticks always belong to the most recent `stage`. */
export interface PipelineProgress {
  stage?(stage: PipelineStageId): void;
  item?: StageItemReporter;
}
