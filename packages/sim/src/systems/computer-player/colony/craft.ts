import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, Carrying, JobAssignment, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { isCarrierJob } from '../../stores/workplace.js';
import { fullCrew } from '../workforce/staffing-rows.js';
import type { ColonyEnv } from './env.js';

function workshopType(env: ColonyEnv, e: Entity): BuildingType | undefined {
  const type = contentIndex(env.ctx.content).buildings.get(env.world.get(e, Building).buildingType);
  return type?.kind === BUILDING_KIND.workplace ? type : undefined;
}

export interface WorkshopSeat {
  readonly building: Entity;
  readonly job: number;
}

/** The craftsmen's seats the colony's standing workshops lack; a carrier any man can be, a gatherer's seat
 *  stays open. */
export function openCraftSeats(env: ColonyEnv, buildings: readonly Entity[]): WorkshopSeat[] {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const seats: WorkshopSeat[] = [];
  for (const building of buildings) {
    const type = workshopType(env, building);
    if (type === undefined || !isBuilt(world, building)) continue;
    const staff = assignedWorkers(world, building);
    for (const { jobType: job, count } of type.workers) {
      if (isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
      const held = staff.filter((e) => world.get(e, Settler).jobType === job).length;
      const want = Math.min(count, fullCrew(world, ctx, seat, type));
      for (let i = held; i < want; i++) seats.push({ building, job });
    }
  }
  return seats;
}

/** A man free to take `job`: no load to drop, and the trade earned. */
export function fitsTrade(env: ColonyEnv, job: number): (e: Entity) => boolean {
  const { world, ctx } = env;
  return (e) => !world.has(e, Carrying) && settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job);
}

/** Whether `e` works a colony workshop: his seat is not a post of {@link POSTS}. */
export function atWorkshop(env: ColonyEnv, e: Entity): boolean {
  const { world, ctx } = env;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const building = workplace === undefined ? undefined : world.tryGet(workplace, Building);
  if (building === undefined) return false;
  return contentIndex(ctx.content).buildings.get(building.buildingType)?.kind === BUILDING_KIND.workplace;
}
