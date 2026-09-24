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

/**
 * Whether a settler has earned `goodType`: every `needforgood` row for it met in repeats. Goods are
 * civilian, so the progression toggle lifts them all with no fighter carve-out.
 */
export function goodUnlockedFor(
  content: UnlockContent,
  progressionEnabled: boolean,
  tribe: number | undefined,
  experience: ReadonlyMap<number, number>,
  goodType: number,
): boolean {
  if (!progressionEnabled) return true;
  const tribeType = content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no requirement table - nothing thresholds it
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== 'good' || req.targetId !== goodType) continue;
    const repeats = systems.requirementRepeats(content.jobExperience, experience, req.experienceTypes);
    if (repeats < req.amount) return false;
  }
  return true;
}
