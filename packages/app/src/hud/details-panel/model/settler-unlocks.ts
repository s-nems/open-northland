import { systems } from '@open-northland/sim';
import { num, settlerExperienceOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type Comp, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { experienceLabel } from './settler.js';

/**
 * The Doświadczenie section's unlock forecast — the dimmed rows under the trained specializations
 * showing repeats-progress toward the `needforjob` gates the settler's CURRENT job is working toward
 * ("Stolarz: 4/10 (Drewno)"). Split from `settler.ts` (its own concern on top of an already-full
 * model file); the repeats arithmetic reads the sim's shared `repeatsForExpType`, so the forecast can
 * never disagree with the gate it predicts (`settlerMeetsNeed`).
 */

/** One upcoming-unlock row: the target profession with the settler's repeats-progress toward its
 *  `needforjob` threshold, pre-formatted ("Stolarz: 4/10 (Drewno)"). */
export interface UnlockProgressRowModel {
  readonly label: string;
  /** Summed repeats across the requirement's experience tracks. */
  readonly current: number;
  /** The requirement's `amount` (the repeats threshold). */
  readonly required: number;
}

/** The most unlock-progress rows the Doświadczenie section shows — the nearest unlocks only, so a
 *  many-gated tribe table can't flood the panel. */
const UPCOMING_UNLOCK_ROWS_MAX = 4;

/**
 * Progress toward the professions the settler's CURRENT job can unlock — the tribe's `needforjob`
 * requirements whose experience tracks this job accrues (a farmer sees the miller gate, a collector
 * the carpenter/mason/smith family), as repeats-progress toward each `amount`. Unmet requirements
 * only, nearest first (highest progress ratio), capped at {@link UPCOMING_UNLOCK_ROWS_MAX}.
 * Fighter-band targets are never listed (barracks training, not experience, unlocks those), and the
 * whole list is empty while profession progression is off — the panel then has nothing to promise.
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
    if (systems.isFighterJob(req.targetId)) continue; // barracks territory, never an XP promise
    // "Reachable": at least one required track is one this settler's current job accrues.
    const tracks = req.experienceTypes.map((t) => ctx.jobExperience.find((d) => d.typeId === t));
    const reachable = tracks.findIndex((t) => t?.jobType === jobType);
    if (reachable < 0) continue;
    let current = 0;
    for (const [i, expType] of req.experienceTypes.entries()) {
      current += systems.repeatsForExpType(tracks[i], points.get(expType) ?? 0);
    }
    if (current >= req.amount) continue; // already unlocked — nothing left to show
    // The row names the track this settler actually trains toward, not blindly the line's first.
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
