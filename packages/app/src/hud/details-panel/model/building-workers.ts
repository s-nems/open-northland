import type { WorldSnapshot } from '@open-northland/sim';
import { actorsOf, isSettler, num } from '../../../game/snapshot.js';
import { type BuildingDef, type Comp, jobDisplayName, type UnitPanelModelContext } from './context.js';

// The building's per-trade worker-slot rows: one filled/capacity line per declared `workers` slot.

/** One worker slot of a building, as a filled/capacity line — e.g. "Cieśla 1/3", "Tragarz 1/1",
 *  "Zbieracz 0/1". One per declared `workers` slot, so each trade shows its own limit, not one aggregate. */
export interface WorkerSlotRow {
  readonly jobType: number;
  readonly label: string;
  /** Settlers currently bound to this building for this job. */
  readonly filled: number;
  /** The slot's `count` — how many of this job the building employs. */
  readonly capacity: number;
}

/** How many settlers are currently bound to `buildingId`, per job — the per-slot "filled" count. */
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

/**
 * The per-trade worker rows: one per declared `workers` slot (in declared order), each with its
 * filled/capacity. A building that employs nobody (a home) yields no rows.
 */
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
