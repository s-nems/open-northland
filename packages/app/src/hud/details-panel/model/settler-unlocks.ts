import { systems } from '@open-northland/sim';
import { isFighterTarget, unmetGoodRequirement } from '../../../game/profession-unlocks.js';
import { num, settlerExperienceOf, settlerLearnedOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type Comp, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { experienceLabel } from './settler.js';

/** One upcoming-unlock row: progress toward a `needforjob` threshold. */
export interface UnlockProgressRowModel {
  /** The profession it unlocks. */
  readonly job: string;
  /** The experience track this settler trains toward it. */
  readonly track: string;
  /** Summed repeats across the requirement's experience tracks. */
  readonly current: number;
  /** The requirement's `amount`. */
  readonly required: number;
}

/** Cap on listed rows, so a many-gated tribe table cannot flood the panel. */
const UPCOMING_UNLOCK_ROWS_MAX = 4;

/**
 * Progress toward the professions the settler's current job can unlock: unmet `needforjob`
 * requirements whose experience tracks this job accrues, nearest first by progress ratio. The repeats
 * arithmetic shares the sim's `requirementRepeats`, so the forecast cannot disagree with the gate.
 */
export function unlockProgressRows(
  ctx: UnitPanelModelContext,
  comps: Comp,
  progressionEnabled: boolean,
): UnlockProgressRowModel[] {
  if (!progressionEnabled) return [];
  const s = (comps.Settler ?? {}) as Comp;
  const jobType = num(s.jobType);
  const tribe = num(s.tribe);
  if (jobType === undefined || tribe === undefined) return [];
  const tribeType = ctx.tribes.find((t) => t.typeId === tribe);
  if (tribeType === undefined) return [];
  const points = settlerExperienceOf(comps);
  const rows: (UnlockProgressRowModel & { targetId: number })[] = [];
  for (const req of tribeType.jobRequirements) {
    if (
      req.requirement !== 'need' ||
      req.target !== 'job' ||
      settlerLearnedOf(comps, 'job').includes(req.targetId)
    )
      continue;
    if (isFighterTarget(ctx, req.targetId)) continue; // barracks territory, never an XP promise
    const tracks = req.experienceTypes.map((t) => ctx.jobExperience.find((d) => d.typeId === t));
    const reachable = tracks.findIndex((t) => t?.jobType === jobType);
    if (reachable < 0) continue;
    const current = systems.requirementRepeats(ctx.jobExperience, points, req.experienceTypes);
    if (current >= req.amount) continue;
    // The row names the track this settler actually trains toward, not the line's first.
    const trackType = req.experienceTypes[reachable];
    const trackLabel =
      trackType !== undefined
        ? experienceLabel(ctx, trackType, tracks[reachable])
        : jobDisplayName(ctx, jobType);
    rows.push({
      job: jobDisplayName(ctx, req.targetId),
      track: trackLabel,
      current,
      required: req.amount,
      targetId: req.targetId,
    });
  }
  rows.sort((a, b) => b.current / b.required - a.current / a.required || a.targetId - b.targetId);
  return rows.slice(0, UPCOMING_UNLOCK_ROWS_MAX).map(({ job, track, current, required }) => ({
    job,
    track,
    current,
    required,
  }));
}

/** Why a settler may not make `goodType` yet under the tribe's `needforgood` table ("8/20 (Kowal)"), or
 *  null once it has earned it. */
export function goodExperienceLock(
  ctx: UnitPanelModelContext,
  comps: Comp,
  progressionEnabled: boolean,
  goodType: number,
): string | null {
  const tribe = num(((comps.Settler ?? {}) as Comp).tribe);
  const unmet = unmetGoodRequirement(ctx, progressionEnabled, tribe, settlerExperienceOf(comps), goodType);
  if (unmet === null) return null;
  const trackType = unmet.experienceTypes[0];
  const track =
    trackType === undefined
      ? ''
      : experienceLabel(
          ctx,
          trackType,
          ctx.jobExperience.find((t) => t.typeId === trackType),
        );
  return formatMessage(messages().hud.settlerPanel.goodLock, {
    current: unmet.current,
    required: unmet.required,
    track,
  });
}
