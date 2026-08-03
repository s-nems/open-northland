import { JobAssignment, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

/** Bound-settler headcount per (building, jobType). The AI player plans a whole decision's staffing before
 *  any of its commands apply, so it counts its own pending posts against this live tally. */
export type StaffingTally = Map<Entity, Map<number, number>>;

export function buildStaffingTally(world: World): StaffingTally {
  const tally: StaffingTally = new Map();
  for (const e of world.query(Settler, JobAssignment)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null) continue;
    const workplace = world.get(e, JobAssignment).workplace;
    incrementStaffing(tally, workplace, jobType);
  }
  return tally;
}

export function incrementStaffing(tally: StaffingTally, workplace: Entity, jobType: number): void {
  const jobs = tally.get(workplace) ?? new Map<number, number>();
  jobs.set(jobType, (jobs.get(jobType) ?? 0) + 1);
  tally.set(workplace, jobs);
}
