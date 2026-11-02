import { JobAssignment, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';

/** Bound-settler headcount per (building, jobType). A decision plans all its staffing before any of its
 *  commands apply, so it counts its own pending posts against this live tally. */
export type StaffingTally = Map<Entity, Map<number, number>>;

/** The tally of every workplace the seat's staffing reads: its own buildings and wherever its settlers are
 *  bound. Each counts all its bound settlers, whatever their owner. */
export function buildStaffingTally(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): StaffingTally {
  const tally: StaffingTally = new Map();
  const counted = new Set<Entity>();
  const count = (workplace: Entity): void => {
    if (counted.has(workplace)) return;
    counted.add(workplace);
    for (const e of assignedWorkers(world, workplace)) {
      const jobType = world.tryGet(e, Settler)?.jobType ?? null;
      if (jobType !== null) incrementStaffing(tally, workplace, jobType);
    }
  };
  for (const building of owned) count(building);
  for (const e of homeSettlers(world, ctx, player)) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace !== undefined) count(workplace);
  }
  return tally;
}

export function incrementStaffing(tally: StaffingTally, workplace: Entity, jobType: number): void {
  const jobs = tally.get(workplace) ?? new Map<number, number>();
  jobs.set(jobType, (jobs.get(jobType) ?? 0) + 1);
  tally.set(workplace, jobs);
}
