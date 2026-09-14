import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';

/**
 * The qualification reading a scene checks off a snapshot, mirroring the sim's `settlerMeetsNeed`
 * `need-job` rule; the profession picker asks the sim itself through `canChooseJob`.
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
 * Whether a settler may take `jobType` right now: every `need-job` row for the target is met in repeats,
 * or progression is off. A fighter job stays gated on the barracks drill either way.
 */
export function jobUnlockedFor(
  content: UnlockContent,
  progressionEnabled: boolean,
  tribe: number | undefined,
  experience: ReadonlyMap<number, number>,
  jobType: number,
): boolean {
  if (!progressionEnabled && !isFighterTarget(content, jobType)) return true; // free start
  return meetsNeedRows(content, tribe, 'job', jobType, experience);
}

/**
 * Whether a settler has earned `goodType`, the `needforgood` sibling of {@link jobUnlockedFor}. Goods
 * are civilian, so the progression toggle lifts them all with no fighter carve-out.
 */
export function goodUnlockedFor(
  content: UnlockContent,
  progressionEnabled: boolean,
  tribe: number | undefined,
  experience: ReadonlyMap<number, number>,
  goodType: number,
): boolean {
  if (!progressionEnabled) return true;
  return meetsNeedRows(content, tribe, 'good', goodType, experience);
}

/** The shared `needfor*` row reading: every `need` row for `(target, targetId)` met in repeats, or, for
 *  a fighter trade, the barracks schooling paid instead. */
function meetsNeedRows(
  content: UnlockContent,
  tribe: number | undefined,
  target: 'job' | 'good',
  targetId: number,
  experience: ReadonlyMap<number, number>,
): boolean {
  const tribeType = content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no requirement table - nothing thresholds it
  if (
    target === 'job' &&
    isFighterTarget(content, targetId) &&
    systems.schoolingMet(content.jobExperience, tribeType.jobRequirements, experience, targetId)
  ) {
    return true;
  }
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== target || req.targetId !== targetId) continue;
    const repeats = systems.requirementRepeats(content.jobExperience, experience, req.experienceTypes);
    if (repeats < req.amount) return false;
  }
  return true;
}
