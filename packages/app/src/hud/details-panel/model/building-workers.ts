import type { WorldSnapshot } from '@open-northland/sim';
import { workerRoleOf } from '../../../game/sandbox/index.js';
import { actorsOf, isSettler, num } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type BuildingDef, type Comp, jobDisplayName, type UnitPanelModelContext } from './context.js';

/** One declared `workers` slot as a filled/capacity line, so each trade shows its own limit rather than
 *  one aggregate. */
export interface WorkerSlotRow {
  readonly jobType: number;
  readonly label: string;
  /** Settlers currently bound to this building for this job. */
  readonly filled: number;
  /** The slot's declared `count`. */
  readonly capacity: number;
}

function boundCountsByJob(snapshot: WorldSnapshot, buildingId: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of actorsOf(snapshot)) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    if (num(assignment?.workplace) !== buildingId) continue;
    const jobType = num((e.components.Settler as Comp | undefined)?.jobType);
    if (jobType === undefined) continue;
    counts.set(jobType, (counts.get(jobType) ?? 0) + 1);
  }
  return counts;
}

export function workerSlotsFor(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  buildingId: number,
): WorkerSlotRow[] {
  const counts = boundCountsByJob(snapshot, buildingId);
  return (def?.workers ?? []).map((slot) => ({
    jobType: slot.jobType,
    label: jobDisplayName(ctx, slot.jobType),
    filled: counts.get(slot.jobType) ?? 0,
    capacity: slot.count,
  }));
}

/**
 * The defence window's status line. The alarm leads because the toggle beside the line controls it;
 * posted archers are a separate mechanic and shoot whether or not the alarm is up.
 */
export function defenseLine(
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  buildingId: number,
  alarm: { sheltered: number; capacity: number } | null,
): string {
  if (alarm !== null) return formatMessage(messages().hud.defenseStarted, alarm);
  const counts = boundCountsByJob(snapshot, buildingId);
  let manned = 0;
  for (const slot of def?.workers ?? []) {
    if (workerRoleOf(slot.jobType) === 'garrison') manned += counts.get(slot.jobType) ?? 0;
  }
  const m = messages().hud;
  return manned > 0 ? `${m.defenseGarrison} ${manned}` : m.defenseStopped;
}
