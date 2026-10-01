import {
  assistantPostsGraduatesEntity,
  ownerOf,
  Settler,
  SettlerProgress,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ownedBuildings } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { bindEmployment, openWorkerJobFromList } from '../economy/jobs/index.js';
import { jobUsesWorkFlag } from '../economy/work-flag.js';
import { routeRegions } from '../footprint/index.js';
import { isTradeAssignable } from '../orders/guards.js';
import { isFighterJob } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import type { NavigationLimit } from '../signposts/index.js';
import { hexNodeDistance } from '../spatial/metric.js';

/**
 * The assistant's graduate posting, checked once as a settler leaves school in `jobType`: with its owner's
 * switch on, bind it to the nearest of the owner's workplaces with a free slot in that trade it can walk to,
 * ties by entity id. Returns whether it was posted; with no such slot nothing happens. A flag gatherer (collector,
 * fisher) is never posted, since its work runs from a flag rather than a building. Source basis: authored,
 * the switch is this project's addition.
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
  if (!isTradeAssignable(world, e)) return false;
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
  const regions = routeRegions(world, ctx, terrain);
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  // Ascending ids, so the first of equally near workplaces wins.
  for (const b of ownedBuildings(world, owner)) {
    if (world.has(b, UnderConstruction)) continue;
    if (openWorkerJobFromList(query, b, [jobType]) === null) continue;
    const door = interactionCell(world, ctx, terrain, b, here);
    if (limit !== null && !limit.allowsNode(door)) continue; // posted there, he would stand lost
    // Across water or walls: a bound post never gives up on its route.
    if (terrain.componentOf(door) !== terrain.componentOf(here) || regions.unroutable(here, door)) continue;
    const distance = hexNodeDistance(terrain, here, door);
    if (distance < bestDistance) {
      best = b;
      bestDistance = distance;
    }
  }
  if (best === null) return false;
  bindEmployment(world, ctx, e, best);
  return true;
}
