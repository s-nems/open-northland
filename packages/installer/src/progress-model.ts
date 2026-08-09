// The `/progress` subpath is import-free: this module rides the browser-side setup bundle, which
// must never drag the pipeline's node:fs decoder graph in.
import type { PipelineStageId } from '@open-northland/asset-pipeline/progress';
import { PIPELINE_STAGES } from '@open-northland/asset-pipeline/progress';

/**
 * Approximation: the weights and item estimates below come from one observed full run against the
 * game copy plus the culturesnation mod. They only shape the bar and never gate completion.
 */

// Approximate seconds per stage in that run.
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
  // The desktop shell has no locally built dmrender, so the music stage skips instantly there;
  // weighting the long render would park the bar at half-done for everyone else.
  music: 1,
};

/** Item counts for the stages that walk as they go without an up-front total. */
const ESTIMATED_ITEMS: Partial<Record<PipelineStageId, number>> = {
  unpack: 4100,
  pictures: 5800,
};

/** Caps an estimated stage so the bar never claims a finish it cannot know. */
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

/** Overall progress across every stage, 0..1. */
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
