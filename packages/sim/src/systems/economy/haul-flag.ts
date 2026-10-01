import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { Building, JobAssignment, Settler } from '../../components/index.js';
import { isCarrierJobId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';

/**
 * Whether a `jobType` worker posted at `buildingType` may be given a pickup flag: a carrier at a warehouse
 * or the headquarters, or at a recipe workshop. A carrier at a farm, herb hut, well, hive, tower or the
 * barracks takes none (owner ruling: a flag there serves nothing).
 */
export function postTakesHaulFlag(content: ContentSet, jobType: number, buildingType: number): boolean {
  const index = contentIndex(content);
  const job = index.jobs.get(jobType);
  const type = index.buildings.get(buildingType);
  if (job === undefined || type === undefined || !isCarrierJobId(job.id)) return false;
  if (type.kind === BUILDING_KIND.storage) return true;
  return (
    index.mergedRecipeByBuilding.has(buildingType) &&
    !type.refillsOwnStock &&
    !type.produces.some((good) => index.goods.get(good)?.farming !== undefined)
  );
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
