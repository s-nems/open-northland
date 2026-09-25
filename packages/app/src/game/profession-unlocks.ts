import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';

/**
 * The qualification reading the details panel checks off a snapshot, mirroring the sim's
 * `settlerMeetsNeed` `needforgood` rule; the profession picker asks the sim itself through `canChooseJob`.
 */

/** The requirement-table slice every qualifier reads, readonly so a full {@link ContentSet} and the
 *  details-panel's context slice both fit. */
export interface UnlockContent {
  readonly tribes: readonly ContentSet['tribes'][number][];
  readonly jobExperience: readonly ContentSet['jobExperience'][number][];
  readonly jobs: readonly ContentSet['jobs'][number][];
}

/** Whether a `need-job` target is a fighter trade: barracks territory, never freed by the progression
 *  toggle and never shown as an XP promise. */
export function isFighterTarget(content: UnlockContent, jobType: number): boolean {
  const job = content.jobs.find((j) => j.typeId === jobType);
  return job !== undefined && systems.isFighterJobRow(job);
}

/** A `needforgood` requirement the settler has not met yet: its repeats so far, the threshold, and the
 *  experience tracks that count toward it. */
export interface UnmetGoodRequirement {
  readonly current: number;
  readonly required: number;
  readonly experienceTypes: readonly number[];
}

/**
 * The first `needforgood` row for `goodType` the settler has not met in repeats, or null once it has
 * earned the good. Goods are civilian, so the progression toggle lifts them all with no fighter
 * carve-out.
 */
export function unmetGoodRequirement(
  content: UnlockContent,
  progressionEnabled: boolean,
  tribe: number | undefined,
  experience: ReadonlyMap<number, number>,
  goodType: number,
): UnmetGoodRequirement | null {
  if (!progressionEnabled) return null;
  const tribeType = content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return null; // no requirement table - nothing thresholds it
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== 'good' || req.targetId !== goodType) continue;
    const current = systems.requirementRepeats(content.jobExperience, experience, req.experienceTypes);
    if (current < req.amount) {
      return { current, required: req.amount, experienceTypes: req.experienceTypes };
    }
  }
  return null;
}
