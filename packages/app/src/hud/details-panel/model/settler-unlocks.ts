import { systems } from '@open-northland/sim';
import { professionDefForJob } from '../../../catalog/professions.js';
import { isFighterTarget, unmetGoodRequirement } from '../../../game/profession-unlocks.js';
import { num, settlerExperienceOf, settlerLearnedOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type Comp, goodLabel, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { experienceLabel } from './settler.js';

/** One upcoming-unlock row: progress toward a `needforjob` or `needforgood` threshold. */
export interface UnlockProgressRowModel {
  /** The profession or the good the threshold unlocks. */
  readonly unlocks: string;
  /** The experience track this settler trains toward it. */
  readonly track: string;
  /** Summed repeats across the requirement's experience tracks. */
  readonly current: number;
  /** The requirement's `amount`. */
  readonly required: number;
}

/** Cap on listed rows, so a many-gated tribe table cannot flood the panel. */
const UPCOMING_UNLOCK_ROWS_MAX = 3;

/**
 * Progress toward what the settler's current job can unlock: unmet `needforjob` and `needforgood`
 * requirements whose experience tracks this job accrues, nearest first by progress ratio. A job target
 * must be one the profession picker offers (a sea trade needs a harbour the game has none of) and no
 * fighter trade (barracks territory, never an XP promise); a good target must be one the mission allows.
 * The repeats arithmetic shares the sim's `requirementRepeats`, so the forecast cannot disagree with the
 * gate.
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
  const owner = num((comps.Owner as { player?: unknown } | undefined)?.player);
  const points = settlerExperienceOf(comps);
  const learnedJobs = settlerLearnedOf(comps, 'job');
  const learnedGoods = settlerLearnedOf(comps, 'good');
  const rows: (UnlockProgressRowModel & { order: number })[] = [];
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need') continue;
    if (req.target === 'job') {
      if (learnedJobs.includes(req.targetId)) continue;
      if (professionDefForJob(req.targetId) === undefined || isFighterTarget(ctx, req.targetId)) continue;
    } else {
      if (learnedGoods.includes(req.targetId)) continue;
      if (!(ctx.goodAllowed?.(req.targetId, tribe, owner) ?? true)) continue;
    }
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
      unlocks: req.target === 'job' ? jobDisplayName(ctx, req.targetId) : goodLabel(ctx, req.targetId),
      track: trackLabel,
      current,
      required: req.amount,
      // Ties break jobs before goods, then by id, so the list holds still between ticks.
      order: (req.target === 'job' ? 0 : ORDER_TARGET_SPAN) + req.targetId,
    });
  }
  rows.sort((a, b) => b.current / b.required - a.current / a.required || a.order - b.order);
  return rows.slice(0, UPCOMING_UNLOCK_ROWS_MAX).map(({ unlocks, track, current, required }) => ({
    unlocks,
    track,
    current,
    required,
  }));
}

/** Past every job id, so a good's tie-break order sorts after a job's. */
const ORDER_TARGET_SPAN = 1_000_000;

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
