import { assistantPostsGraduatesEntity, ownerOf, Settler, SettlerProgress } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { ownedBuildings } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { bindEmployment, craftsAnyAt, openWorkerJobFromList } from '../economy/jobs/index.js';
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
 * ties by entity id. A foundation counts, since a site takes its staff from placement. Returns whether it was
 * posted; with no such slot nothing happens. A workplace that crafts a method the settler learned wins over
 * a nearer one that does not, and the graduate starts on those methods. A flag gatherer (collector, fisher)
 * is never posted, since its work runs from a flag rather than a building. Source basis: authored, the
 * switch is this project's addition.
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
  const methods = progress.learned?.good ?? [];
  const regions = routeRegions(world, ctx, terrain);
  let best: Entity | null = null;
  let bestCrafts = false;
  let bestDistance = Number.POSITIVE_INFINITY;
  // Ascending ids, so the first of equally ranked workplaces wins.
  for (const b of ownedBuildings(world, owner)) {
    if (openWorkerJobFromList(query, b, [jobType]) === null) continue;
    const crafts = craftsAnyAt(world, ctx, b, jobType, methods);
    if (bestCrafts && !crafts) continue;
    const door = interactionCell(world, ctx, terrain, b, here);
    if (limit !== null && !limit.allowsNode(door)) continue; // posted there, he would stand lost
    // Across water or walls: a bound post never gives up on its route.
    if (terrain.componentOf(door) !== terrain.componentOf(here) || regions.unroutable(here, door)) continue;
    const distance = hexNodeDistance(terrain, here, door);
    if (crafts !== bestCrafts || distance < bestDistance) {
      best = b;
      bestCrafts = crafts;
      bestDistance = distance;
    }
  }
  if (best === null) return false;
  bindEmployment(world, ctx, e, best, methods);
  return true;
}
