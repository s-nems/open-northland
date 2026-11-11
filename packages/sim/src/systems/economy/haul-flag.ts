import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { Building, DEFAULT_WORK_FLAG_RADIUS, JobAssignment, Settler } from '../../components/index.js';
import { isCarrierJobId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { jobNeedsWorkHouse } from '../readviews/index.js';
import { isStorageBuildingType } from '../stores/index.js';
import { sowsFieldsAt } from './fields.js';
import { jobUsesWorkFlag } from './work-flag.js';

/**
 * Whether a `jobType` worker posted at `buildingType` may be given a flag of its own: a field trade
 * ({@link worksFieldFromPost}) at any post, the trade sowing a farm's fields, a carrier at a warehouse or
 * the headquarters, or at a recipe workshop. A carrier at a farm, herb hut, well, hive, tower or the
 * barracks takes none (owner ruling: a flag there serves nothing).
 */
export function postTakesHaulFlag(content: ContentSet, jobType: number, buildingType: number): boolean {
  const index = contentIndex(content);
  const job = index.jobs.get(jobType);
  const type = index.buildings.get(buildingType);
  if (job === undefined || type === undefined) return false;
  if (worksFieldFromPost(content, jobType) || sowsFieldsAt(content, jobType, buildingType)) return true;
  if (!isCarrierJobId(job.id)) return false;
  if (type.kind === BUILDING_KIND.storage) return true;
  return (
    index.mergedRecipeByBuilding.has(buildingType) &&
    !type.refillsOwnStock &&
    !type.produces.some((good) => index.goods.get(good)?.farming !== undefined)
  );
}

/** A trade that gathers, hunts or fishes from a flag and may work its post's flag the same way: every flag
 *  trade but one bound to its workhouse, as the farmer and the herb gatherer reap their own hut's fields. */
export function worksFieldFromPost(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && jobUsesWorkFlag({ content }, jobType) && !jobNeedsWorkHouse(content, jobType);
}

/** Whether settler `e` holds a post {@link postTakesHaulFlag} admits. */
export function holdsHaulFlagPost(world: World, ctx: ContentContext, e: Entity): boolean {
  const jobType = world.tryGet(e, Settler)?.jobType;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const buildingType = workplace === undefined ? undefined : world.tryGet(workplace, Building)?.buildingType;
  return (
    jobType !== null &&
    jobType !== undefined &&
    buildingType !== undefined &&
    postTakesHaulFlag(ctx.content, jobType, buildingType)
  );
}

/** How far (Manhattan half-cell nodes) from its workplace a porter without a flag lifts ground piles: the
 *  reach of a newly placed flag standing at the building's centre (owner's choice). Original behavior, for
 *  comparison and unconfirmed against the running original: a store carrier searches 20 map points around
 *  its work point, a farm carrier 10. */
export const WORKPLACE_COLLECT_RADIUS = DEFAULT_WORK_FLAG_RADIUS;

/** Whether a `jobType` worker posted at `buildingType` is a porter, which without a flag lifts ground piles
 *  within {@link WORKPLACE_COLLECT_RADIUS} of its workplace: a carrier at a building that stores rather than
 *  crafts. */
export function postCollectsAroundWorkplace(
  content: ContentSet,
  jobType: number,
  buildingType: number,
): boolean {
  const job = contentIndex(content).jobs.get(jobType);
  return job !== undefined && isCarrierJobId(job.id) && isStorageBuildingType(content, buildingType);
}
