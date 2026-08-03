import { systems } from '@open-northland/sim';
import { isFighterTarget } from '../../../game/profession-unlocks.js';
import { num, settlerExperienceOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type Comp, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { experienceLabel } from './settler.js';

/** One upcoming-unlock row: progress toward a `needforjob` threshold, pre-formatted. */
export interface UnlockProgressRowModel {
  readonly label: string;
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
    if (req.requirement !== 'need' || req.target !== 'job') continue;
    if (isFighterTarget(ctx, req.targetId)) continue; // barracks territory, never an XP promise
    // "Reachable": at least one required track is one this settler's current job accrues.
    const tracks = req.experienceTypes.map((t) => ctx.jobExperience.find((d) => d.typeId === t));
    const reachable = tracks.findIndex((t) => t?.jobType === jobType);
    if (reachable < 0) continue;
    const current = systems.requirementRepeats(ctx.jobExperience, points, req.experienceTypes);
    if (current >= req.amount) continue; // already unlocked - nothing left to show
    // The row names the track this settler actually trains toward, not the line's first.
    const trackType = req.experienceTypes[reachable];
    const trackLabel =
      trackType !== undefined
        ? experienceLabel(ctx, trackType, tracks[reachable])
        : jobDisplayName(ctx, jobType);
    rows.push({
      label: formatMessage(messages().hud.unlockProgress, {
        job: jobDisplayName(ctx, req.targetId),
        current,
        required: req.amount,
        track: trackLabel,
      }),
      current,
      required: req.amount,
      targetId: req.targetId,
    });
  }
  rows.sort((a, b) => b.current / b.required - a.current / a.required || a.targetId - b.targetId);
  return rows.slice(0, UPCOMING_UNLOCK_ROWS_MAX).map(({ label, current, required }) => ({
    label,
    current,
    required,
  }));
}
