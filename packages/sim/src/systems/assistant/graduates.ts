import {
  assistantPostsGraduatesEntity,
  ownerOf,
  Settler,
  SettlerProgress,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ownedBuildings } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { bindEmployment, craftsAnyAt, openWorkerJobFromList } from '../economy/jobs/index.js';
import { jobUsesWorkFlag } from '../economy/work-flag.js';
import { routeRegions } from '../footprint/index.js';
import { schoolTeachesMethodChoice } from '../orders/education.js';
import { isTradeAssignable } from '../orders/guards.js';
import { isFighterJob } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { assignedWorkers } from '../stores/assigned-workers.js';

/**
 * The assistant's graduate posting, checked once as a settler leaves school in `jobType`: with its owner's
 * switch on, bind it to the nearest of the owner's workplaces with a free slot in that trade it can walk to,
 * ties by entity id. A foundation counts, since a site takes its staff from placement. Returns whether it was
 * posted; with no such slot nothing happens. Workplaces rank, before distance: a finished one over a site,
 * then one nobody of that trade works at yet over a staffed one (a second mill gets its first miller before
 * the first gets its second), then, where the school teaches the trade several methods, one that crafts a
 * method the settler learned, which the graduate then starts on. A flag gatherer (collector, fisher) is never
 * posted, since its work runs from a flag rather than a building. Source basis: authored, the switch is this
 * project's addition.
 */
export function postGraduate(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
  jobType: number,
): boolean {
  const owner = ownerOf(world, e);
  if (owner === undefined || assistantPostsGraduatesEntity(world, owner) === null) return false;
  if (jobUsesWorkFlag(ctx, jobType) || isFighterJob(ctx.content, jobType)) return false;
  if (!isTradeAssignable(world, ctx.content, e)) return false;
  const settler = world.get(e, Settler);
  const progress = world.get(e, SettlerProgress);
  const query = {
    world,
    ctx,
    tribe: settler.tribe,
    owner,
    experience: progress.experience,
    learned: progress.learned,
    jobType: settler.jobType,
  };
  // A trade with a single school method keeps its first product: the player picked the trade, not a ware
  // (a baker taught cakes still bakes bread first).
  const methods = schoolTeachesMethodChoice(ctx.content, settler.tribe, jobType)
    ? (progress.learned?.good ?? [])
    : [];
  const regions = routeRegions(world, ctx, terrain);
  let best: Entity | null = null;
  let bestRank = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  // Ascending ids, so the first of equally ranked workplaces wins.
  for (const b of ownedBuildings(world, owner)) {
    if (openWorkerJobFromList(query, b, [jobType]) === null) continue;
    const rank = workplaceRank(world, ctx, b, jobType, methods);
    if (rank < bestRank) continue;
    const door = interactionCell(world, ctx, terrain, b, here);
    if (limit !== null && !limit.allowsNode(door)) continue; // posted there, he would stand lost
    // Across water or walls: a bound post never gives up on its route.
    if (terrain.componentOf(door) !== terrain.componentOf(here) || regions.unroutable(here, door)) continue;
    const distance = hexNodeDistance(terrain, here, door);
    if (rank > bestRank || distance < bestDistance) {
      best = b;
      bestRank = rank;
      bestDistance = distance;
    }
  }
  if (best === null) return false;
  bindEmployment(world, ctx, e, best, methods);
  return true;
}

const RANK_FINISHED = 4;
const RANK_UNSTAFFED = 2;
const RANK_CRAFTS_LEARNED = 1;

/** Higher wins: finished over a site, then unstaffed in the trade, then crafting a learned method. */
function workplaceRank(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  jobType: number,
  methods: readonly number[],
): number {
  let rank = 0;
  if (!world.has(workplace, UnderConstruction)) rank += RANK_FINISHED;
  if (!holdsTrade(world, workplace, jobType)) rank += RANK_UNSTAFFED;
  if (craftsAnyAt(world, ctx, workplace, jobType, methods)) rank += RANK_CRAFTS_LEARNED;
  return rank;
}

function holdsTrade(world: World, workplace: Entity, jobType: number): boolean {
  for (const w of assignedWorkers(world, workplace)) {
    if (world.tryGet(w, Settler)?.jobType === jobType) return true;
  }
  return false;
}
