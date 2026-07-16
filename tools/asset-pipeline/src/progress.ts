/**
 * The pipeline's progress seam. A conversion of a full game copy takes minutes, so an embedding
 * host (the desktop shell's first-run installer) needs live feedback; the CLI passes nothing and
 * keeps its stage summary logs. Reporting is best-effort telemetry: reporters must not throw, and
 * stages ignore the seam entirely when absent.
 */

/** Stage ids in `runPipeline`'s fixed execution order; hosts map them to labels and weights. */
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
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

/**
 * Per-item heartbeat within the current stage: `done` items so far; `total` when the stage knows its
 * item count up front (walk-as-you-go stages report `undefined` — a moving counter, not a fraction).
 */
export type StageItemReporter = (done: number, total?: number) => void;

/** Progress callbacks for {@link runPipeline}; `item` ticks always belong to the last `stage`. */
export interface PipelineProgress {
  stage?(stage: PipelineStageId): void;
  item?: StageItemReporter;
}
