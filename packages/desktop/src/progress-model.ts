// The `/progress` subpath is import-free by design — this module rides the browser-side setup
// bundle, which must never drag the pipeline's node:fs decoder graph in.
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import { PIPELINE_STAGES } from '@open-northland/asset-pipeline/progress';

/**
 * Maps the pipeline's progress events onto one 0..1 fraction for the installer's bar. Stage weights
 * and the item estimates for walk-as-you-go stages are approximations observed from one full run
 * against the real game copy + culturesnation mod (2026-07-16, 167 s end to end); they only shape
 * the bar, never gate completion, so drift on other installs is cosmetic.
 */

// Roughly the stage's seconds in the reference run (167 s total): atlases and pictures dominate;
// everything from gui onward fits in the final seconds.
const STAGE_WEIGHTS: Readonly<Record<PipelineStageId, number>> = {
  unpack: 10,
  pictures: 55,
  atlases: 85,
  'player-colors': 15,
  gui: 2,
  fonts: 1,
  goods: 1,
  ir: 2,
  transitions: 1,
  maps: 3,
};

/** Expected item counts for stages that walk as they go (no up-front total): the reference run
 * extracted ~4,100 archive members and converted ~5,800 pictures. */
const ESTIMATED_ITEMS: Partial<Record<PipelineStageId, number>> = {
  unpack: 4100,
  pictures: 5800,
};

/** Progress within an estimated-total stage is capped here so the bar never claims a finish it can't know. */
const ESTIMATE_CAP = 0.95;

const TOTAL_WEIGHT = PIPELINE_STAGES.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);

export interface ProgressSnapshot {
  readonly stage: PipelineStageId;
  readonly done: number;
  readonly total: number | undefined;
}

/** Fraction of a single stage completed, 0..1. */
function stageFraction(snapshot: ProgressSnapshot): number {
  if (snapshot.total !== undefined && snapshot.total > 0) {
    return Math.min(snapshot.done / snapshot.total, 1);
  }
  const estimate = ESTIMATED_ITEMS[snapshot.stage];
  if (estimate === undefined || snapshot.done <= 0) return 0;
  return Math.min(snapshot.done / estimate, ESTIMATE_CAP);
}

/** Overall 0..1 fraction: completed stage weights + the current stage's weighted fraction. */
export function overallFraction(snapshot: ProgressSnapshot): number {
  const index = PIPELINE_STAGES.indexOf(snapshot.stage);
  let completed = 0;
  for (let i = 0; i < index; i++) {
    const stage = PIPELINE_STAGES[i];
    if (stage !== undefined) completed += STAGE_WEIGHTS[stage];
  }
  const current = STAGE_WEIGHTS[snapshot.stage] * stageFraction(snapshot);
  return (completed + current) / TOTAL_WEIGHT;
}

/** Human labels for the installer's stage line. */
export const STAGE_LABELS: Readonly<Record<PipelineStageId, string>> = {
  unpack: 'Unpacking game archives',
  pictures: 'Converting pictures',
  atlases: 'Building sprite atlases',
  'player-colors': 'Building player colours',
  gui: 'Converting the interface art',
  fonts: 'Converting fonts',
  goods: 'Converting goods icons',
  ir: 'Extracting game rules',
  transitions: 'Composing terrain transitions',
  maps: 'Decoding maps',
};
