import {
  Carrying,
  FishSwarm,
  GroundDrop,
  HarvestedBy,
  ownerOf,
  ownersCompatible,
  Position,
  ProductionCounters,
  productionCountOf,
  Settler,
  SiteAssignment,
  Stockpile,
  WorkFlag,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { surveyHuntingGame } from '../conflict/hunting/index.js';
import type { SystemContext } from '../context.js';
import { FISH_SHORE_SEARCH_RADIUS } from '../economy/fish.js';
import { nodeHoldsOpenGood, openGatherGoods } from '../economy/gather-goods.js';
import { liveFlagOf } from '../economy/work-flag.js';
import { workBoundDistance } from '../settlers/targets/resource-stances.js';
import { nearestHarvestableFor } from '../settlers/targets/resources.js';
import { StoreSinks } from '../settlers/targets/stores/sinks.js';
import { takesDeposits } from '../settlers/targets/stores/stock.js';
import { interactionCell, jobAtomics } from '../settlers/targets/workplaces.js';
import { navigationLimitFor } from '../signposts/index.js';
import { fishSwarmsNearNode } from '../spatial/fish.js';
import { entityNode } from '../spatial/nodes.js';
import { canonicalResources, resourcesNearNode } from '../spatial/resources.js';
import { bankedSlot, workplaceStocksGood, workplaceStoredGoods } from '../stores/index.js';
import { isFisherJob, isHunterJob } from './jobs.js';
import { storesOnlyOutOfReach } from './store-reach.js';
import type { WorkStatus } from './work-status.js';

/** Selected diagnostics inspect at most this many resource candidates. Absence is reported only after
 *  a complete search; a larger candidate band leaves the reason explicitly unknown. */
const MAX_DIAGNOSTIC_RESOURCES = 128;

export function gatherWorkStatus(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  workplace: Entity | undefined,
  gathered: readonly number[],
): WorkStatus | undefined {
  const counters = world.tryGet(entity, ProductionCounters);
  const stored = workplace === undefined ? undefined : workplaceStoredGoods(world, ctx, workplace);
  const stocked =
    stored === undefined ? gathered : gathered.filter((good) => workplaceStocksGood(ctx, stored, good));
  const wanted = stocked.filter((good) => productionCountOf(counters, good) > 0);
  const settler = world.get(entity, Settler);
  const jobType = settler.jobType;
  const terrain = ctx.terrain;
  const position = world.tryGet(entity, Position);
  if (jobType === null || terrain === undefined || position === undefined)
    return { kind: 'unknown', reason: 'gatherSearch' };
  const resourceSearchUnsupported =
    isHunterJob(ctx.content, jobType) ||
    isFisherJob(ctx.content, jobType) ||
    gathered.some((good) => contentIndex(ctx.content).goods.get(good)?.farming !== undefined);
  const load = world.tryGet(entity, Carrying);
  if (load !== undefined && load.amount > 0) {
    if (resourceSearchUnsupported) return { kind: 'unknown', reason: 'gatherSearch' };
    if (world.has(entity, WorkFlag) || world.has(entity, SiteAssignment))
      return { kind: 'unknown', reason: 'gatherSearch' };
    const owner = ownerOf(world, entity);
    const sinks = StoreSinks.of(world, ctx).sinks(load.goodType, false);
    if (storesOnlyOutOfReach(world, ctx, entity, sinks))
      return { kind: 'noOutputDestination', goodType: load.goodType, reason: 'outOfReach' };
    let examined = 0;
    for (const sink of sinks) {
      if (examined++ >= MAX_DIAGNOSTIC_RESOURCES)
        return { kind: 'noOutputDestination', goodType: load.goodType, reason: 'unknown' };
      if (ownersCompatible(owner, ownerOf(world, sink))) return { kind: 'unknown', reason: 'gatherSearch' };
    }
    const stores = world.canonicalQuery(Stockpile, Position);
    if (stores.length > MAX_DIAGNOSTIC_RESOURCES)
      return { kind: 'noOutputDestination', goodType: load.goodType, reason: 'unknown' };
    const canHold = stores.some(
      (store) =>
        takesDeposits(world, store) &&
        ownersCompatible(owner, ownerOf(world, store)) &&
        bankedSlot(world, ctx, store, load.goodType).capacity > 0,
    );
    return {
      kind: 'noOutputDestination',
      goodType: load.goodType,
      reason: canHold ? 'unknown' : 'noStorage',
    };
  }
  const stopped = stocked.length > 0 && counters !== undefined && wanted.length === 0;
  const wf = world.tryGet(entity, WorkFlag);
  const flag = wf !== undefined && world.has(wf.flag, Position) ? wf : undefined;
  // A hunter's ladder takes the piles and carcasses in its ground before it stands idle, so for an idle
  // hunter the reason lies in the prey search alone.
  if (isHunterJob(ctx.content, jobType)) {
    return stopped ? { kind: 'nothingSelected' } : huntWorkStatus(world, ctx, terrain, entity, jobType);
  }
  // A fisher's work is the shore search alone, so its reason lies there too.
  if (isFisherJob(ctx.content, jobType)) {
    const from = liveFlagOf(world, entity)?.flag ?? entity;
    return stopped ? { kind: 'nothingSelected' } : fishWorkStatus(world, terrain, from);
  }
  const node = nodeOfPosition(position.x, position.y);
  const here = terrain.nodeAtClamped(node.hx, node.hy);
  // The work area is the gatherer's own flag, a work flag or the one its post took.
  const own = liveFlagOf(world, entity);
  const area =
    own === undefined
      ? undefined
      : { center: interactionCell(world, ctx, terrain, own.flag, here), radius: own.radius };
  const maxWorkOffset = contentIndex(ctx.content).maxResourceWorkOffset;
  // Already-harvested piles remain work even after a gathering counter stops. Their own delivery and
  // reachability policies need a separate diagnosis; never call a harvest-only search proof of no work.
  // A flag gatherer carries off only the piles it dug itself. A posted one lifts piles whose stance, a
  // work offset from the pile, lies within its area widened by the trunk slack, another work offset.
  const pileReach = area === undefined ? 0 : area.radius + maxWorkOffset + maxWorkOffset;
  const counts = (pile: Entity): boolean => {
    if (flag !== undefined) return world.tryGet(pile, HarvestedBy)?.by === entity;
    if (area === undefined) return true;
    const at = terrain.coordsOf(entityNode(world, terrain, pile));
    return workBoundDistance(terrain, area, at.x, at.y) <= pileReach;
  };
  if (world.canonicalQuery(GroundDrop, Stockpile, Position).some(counts))
    return { kind: 'unknown', reason: 'gatherSearch' };
  if (stopped) return { kind: 'nothingSelected' };
  // Farmers can sow new plots.
  if (resourceSearchUnsupported) return { kind: 'unknown', reason: 'gatherSearch' };
  const limit = navigationLimitFor(world, ctx.content, terrain, entity);
  const allowed = jobAtomics(ctx, jobType);
  const center = area === undefined ? undefined : terrain.coordsOf(area.center);
  const candidates =
    center === undefined || area === undefined
      ? canonicalResources(world)
      : resourcesNearNode(world, center.x, center.y, area.radius + maxWorkOffset, allowed);
  const bounded = candidates.length > MAX_DIAGNOSTIC_RESOURCES;
  const inspected = bounded ? candidates.slice(0, MAX_DIAGNOSTIC_RESOURCES) : candidates;
  const open = openGatherGoods(world, ctx, entity, jobType);
  const diagnostic = { eligibleInArea: false };
  const found = nearestHarvestableFor(
    { world, ctx, entity, terrain, here, limit, jobType, targets: { resources: inspected } },
    {
      // Ranked by distance: the answer read is only whether one qualifies.
      ...(area === undefined ? {} : { bound: area, rank: area.center }),
      ...(stored === undefined
        ? {}
        : {
            goodFilter: new Set(
              ctx.content.goods
                .map((good) => good.typeId)
                .filter((good) => workplaceStocksGood(ctx, stored, good)),
            ),
          }),
      ...(open === undefined
        ? {}
        : { admits: (resource: Entity) => nodeHoldsOpenGood(world, resource, open) }),
      candidates: inspected,
      diagnostic,
    },
  );
  if (found !== null || bounded) return { kind: 'unknown', reason: 'gatherSearch' };
  if (diagnostic.eligibleInArea) return { kind: 'resourceRouteBlocked', goodTypes: wanted.slice() };
  return {
    kind: 'noEligibleResource',
    goodTypes: wanted.slice(),
    scope: area !== undefined || limit !== null ? 'workArea' : 'map',
  };
}

function huntWorkStatus(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  entity: Entity,
  jobType: number,
): WorkStatus {
  switch (surveyHuntingGame(world, ctx, terrain, entity, jobType)) {
    case 'none':
      return { kind: 'noGame' };
    case 'cutOff':
      return { kind: 'gameOutOfReach' };
    case 'game':
    case null:
      return { kind: 'unknown', reason: 'gatherSearch' };
  }
}

/**
 * `noFish` once no swarm with fish left lies in the square twice the shore search around where the
 * fisher's search starts (`from`): a cast stands on a shore at most that search away and reaches a swarm
 * at most that far again. Anything nearer may still be fish it cannot reach, which the diagnosis leaves
 * unknown.
 */
function fishWorkStatus(world: World, terrain: TerrainGraph, from: Entity): WorkStatus {
  const origin = terrain.coordsOf(entityNode(world, terrain, from));
  const reach = 2 * FISH_SHORE_SEARCH_RADIUS;
  for (const swarm of fishSwarmsNearNode(world, origin.x, origin.y, reach)) {
    if (world.get(swarm, FishSwarm).count > 0) return { kind: 'unknown', reason: 'gatherSearch' };
  }
  return { kind: 'noFish' };
}
