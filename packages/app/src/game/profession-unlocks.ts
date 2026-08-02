import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { num, progressionGatesSettler, settlerExperienceOf } from './snapshot.js';

/**
 * The profession picker's qualification filter - the app-side mirror of the sim's `settlerMeetsNeed`
 * `need-job` reading (the same rows, the same `requirementRepeats` arithmetic), computed off the
 * snapshot because the picker cannot reach into live sim state. The `setJob` command enforces the
 * identical gate sim-side, so a filtered-out row could not have been obeyed anyway; this filter is the
 * player-facing half ("the rest is discovered through the tree").
 */

/** The requirement-table slice every qualifier reads - readonly, so both a full {@link ContentSet}
 *  and the details-panel's readonly context slice fit. */
export interface UnlockContent {
  readonly tribes: readonly ContentSet['tribes'][number][];
  readonly jobExperience: readonly ContentSet['jobExperience'][number][];
  /** The job rows the fighter carve-out reads its role off ({@link isFighterTarget}). */
  readonly jobs: readonly ContentSet['jobs'][number][];
}

/** Whether a `need-job` target is a fighter trade - barracks territory, never freed by the progression
 *  toggle and never shown as an XP promise. The sim's role rule against the rows the caller holds. */
export function isFighterTarget(content: UnlockContent, jobType: number): boolean {
  const job = content.jobs.find((j) => j.typeId === jobType);
  return job !== undefined && systems.isFighterJobRow(job);
}

/**
 * Whether a settler with `tribe`/`experience` may take `jobType` right now: every `need-job` row for
 * the target is met in repeats, or profession progression is off (civilian jobs free; a fighter job stays
 * gated on the barracks drill either way - the sim's exact carve-out).
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
 * Whether a settler with `tribe`/`experience` has earned `goodType` - the good-target sibling of
 * {@link jobUnlockedFor} (`needforgood`: a fresh smith forges only the ungated wares). Filters the craft
 * and gather product menus; the sim enforces the identical gate in the cycle rotation and harvest
 * targeting. Goods are civilian, so the progression toggle lifts them all - no fighter carve-out.
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

/** The shared `needfor*` row reading: every `need` row for `(target, targetId)` met in repeats - or, for
 *  a fighter trade, the barracks schooling paid instead (the sim's alternative path, `schoolingMet`). */
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

/**
 * Whether EVERY settler in `settlerIds` may take `jobType` - the multi-selection picker rule (a row is
 * offered only when the order would apply to the whole selection; the sim would silently skip the
 * unqualified anyway). Whether the tree gates a settler is per settler (an AI-owned one is exempt), but
 * its world-wide inputs are resolved once per snapshot - see {@link progressionGatesSettler}.
 */
export function jobUnlockedForSelection(
  content: UnlockContent,
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  jobType: number,
): boolean {
  for (const id of settlerIds) {
    const ent = entityById(snapshot, id);
    if (ent === undefined) continue; // gone mid-frame - the sim will skip it too
    const settler = ent.components.Settler as { tribe?: unknown } | undefined;
    const experience = settlerExperienceOf(ent.components);
    const gated = progressionGatesSettler(snapshot, ent);
    if (!jobUnlockedFor(content, gated, num(settler?.tribe), experience, jobType)) return false;
  }
  return true;
}
