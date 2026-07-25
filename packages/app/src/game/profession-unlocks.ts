import type { ContentSet } from '@open-northland/data';
import { systems, type WorldSnapshot } from '@open-northland/sim';
import { entityById, num, professionProgressionEnabledIn, settlerExperienceOf } from './snapshot.js';

/**
 * The profession picker's qualification filter — the app-side mirror of the sim's `settlerMeetsNeed`
 * `need-job` reading (the same rows, the same `repeatsForExpType` arithmetic), computed off the
 * snapshot because the picker cannot reach into live sim state. The `setJob` command enforces the
 * identical gate sim-side, so a filtered-out row could not have been obeyed anyway; this filter is the
 * player-facing half ("the rest is discovered through the tree").
 */

/**
 * Whether a settler with `tribe`/`experience` may take `jobType` right now: every `need-job` row for
 * the target is met in repeats, or profession progression is off (civilian jobs free; fighter-band
 * jobs stay barracks-gated — the sim's exact carve-out).
 */
export function jobUnlockedFor(
  content: Pick<ContentSet, 'tribes' | 'jobExperience'>,
  progressionEnabled: boolean,
  tribe: number | undefined,
  experience: ReadonlyMap<number, number>,
  jobType: number,
): boolean {
  if (!progressionEnabled && !systems.isFighterJob(jobType)) return true; // free start
  const tribeType = content.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return true; // no requirement table — nothing thresholds it
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== 'job' || req.targetId !== jobType) continue;
    let repeats = 0;
    for (const expType of req.experienceTypes) {
      const track = content.jobExperience.find((t) => t.typeId === expType);
      repeats += systems.repeatsForExpType(track, experience.get(expType) ?? 0);
    }
    if (repeats < req.amount) return false;
  }
  return true;
}

/**
 * Whether EVERY settler in `settlerIds` may take `jobType` — the multi-selection picker rule (a row is
 * offered only when the order would apply to the whole selection; the sim would silently skip the
 * unqualified anyway). Reads the progression flag once off the snapshot.
 */
export function jobUnlockedForSelection(
  content: Pick<ContentSet, 'tribes' | 'jobExperience'>,
  snapshot: WorldSnapshot,
  settlerIds: readonly number[],
  jobType: number,
): boolean {
  const enabled = professionProgressionEnabledIn(snapshot);
  for (const id of settlerIds) {
    const ent = entityById(snapshot, id);
    if (ent === undefined) continue; // gone mid-frame — the sim will skip it too
    const settler = ent.components.Settler as { tribe?: unknown } | undefined;
    const experience = settlerExperienceOf(ent.components);
    if (!jobUnlockedFor(content, enabled, num(settler?.tribe), experience, jobType)) return false;
  }
  return true;
}
