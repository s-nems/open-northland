import { FishSwarm, Position, Settler } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { fx } from '../../../../core/fixed.js';
import type { Entity } from '../../../../ecs/world.js';
import { hexNeighboursOf, nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { FISH_CAST_ATOMIC, FISH_SHORE_SEARCH_RADIUS } from '../../../economy/fish.js';
import { dynamicBlockOverlay, routeRegions } from '../../../footprint/index.js';
import { experienceBonus, trackFor, workRepeatsFor } from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { isFisherJob } from '../../../readviews/index.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import { closer, manhattan, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../spatial/metric.js';
import { atOrWalk, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { unreachableWorkCell } from '../../targets/index.js';
import { unreachableGoals } from '../../unreachable-goals.js';

/** Plan the land fisher onto a nearby reachable shore from which an authored swarm is in range. */
export function planFisher(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: fisher, here } = plan;
  if (!isFisherJob(ctx.content, plan.jobType)) return false;
  const fishGood = contentIndex(ctx.content).goodTypeBySlug.get('fish');
  if (fishGood === undefined) return false;

  const hereCoords = terrain.coordsOf(here);
  const candidates = fishSwarmsNearNode(
    world,
    hereCoords.x,
    hereCoords.y,
    // The swarm can sit one full source radius beyond its resolved shore.
    2 * FISH_SHORE_SEARCH_RADIUS,
  );
  const gates = {
    terrain,
    blocked: dynamicBlockOverlay(world, ctx, terrain),
    memo: unreachableGoals(world, ctx, fisher),
  };
  const regions = routeRegions(world, ctx, terrain);
  let best: { entity: Entity; shore: NodeId; dist: number } | null = null;
  for (const entity of candidates) {
    const swarm = world.get(entity, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    const at = world.get(entity, Position);
    const swarmPosition = nodeOfPosition(at.x, at.y);
    const swarmNode = terrain.nodeAtClamped(swarmPosition.hx, swarmPosition.hy);
    const shore =
      nearbyFishingShore(plan, gates, regions, swarmNode) ??
      (terrain.landVertices === undefined ? swarm.shore : null);
    if (shore === null) continue;
    const dist = manhattan(terrain, here, shore);
    if (dist > FISH_SHORE_SEARCH_RADIUS) continue;
    if (plan.limit !== null && !plan.limit.allowsNode(shore)) continue;
    if (unreachableWorkCell(gates, here, shore) || regions.unroutable(here, shore)) continue;
    if (best === null || closer(dist, shore, best.dist, best.shore)) best = { entity, shore, dist };
  }
  if (best === null) return false;

  atOrWalk(world, fisher, here, best.shore, () =>
    startAtomic(
      world,
      fisher,
      FISH_CAST_ATOMIC,
      {
        kind: 'fish',
        swarm: best.entity,
        goodType: fishGood,
        repeatsLeft: fishingRetriesFor(plan, fishGood),
        phase: 'cast',
      },
      atomicDuration(ctx.content, plan, FISH_CAST_ATOMIC),
      best.entity,
    ),
  );
  return true;
}

/**
 * analysis's `FindShorePointForFishing` searches outward from the fisher, retains up to eight reachable
 * land points beside water and accepts one when a swarm is within 20 nodes of that water edge. We pick
 * the canonical nearest match instead of using randomness. The spawn-time shore remains a fallback for
 * synthetic maps which represent authored fish without water terrain.
 */
function nearbyFishingShore(
  plan: PlannerContext,
  gates: Parameters<typeof unreachableWorkCell>[0],
  regions: ReturnType<typeof routeRegions>,
  swarm: NodeId,
): NodeId | null {
  const { terrain, here } = plan;
  const origin = terrain.coordsOf(here);
  for (let radius = 0; radius <= FISH_SHORE_SEARCH_RADIUS; radius++) {
    const count = ringOffsetCount(radius);
    for (let i = 0; i < count; i++) {
      const x = origin.x + ringOffsetDx(radius, i);
      const y = origin.y + ringOffsetDy(radius, i);
      if (!terrain.inBounds(x, y)) continue;
      const shore = terrain.nodeAt(x, y);
      if (plan.limit !== null && !plan.limit.allowsNode(shore)) continue;
      if (unreachableWorkCell(gates, here, shore) || regions.unroutable(here, shore)) continue;
      if (waterEdgeCanReachSwarm(terrain, x, y, swarm)) return shore;
    }
  }
  return null;
}

function waterEdgeCanReachSwarm(
  terrain: PlannerContext['terrain'],
  shoreX: number,
  shoreY: number,
  swarm: NodeId,
): boolean {
  for (const water of hexNeighboursOf(shoreX, shoreY)) {
    if (!terrain.inBounds(water.hx, water.hy)) continue;
    const waterNode = terrain.nodeAt(water.hx, water.hy);
    const isWater =
      !terrain.isWalkable(waterNode) &&
      (terrain.landVertices === undefined || terrain.landVertices[waterNode] !== true);
    if (isWater && manhattan(terrain, waterNode, swarm) <= FISH_SHORE_SEARCH_RADIUS) {
      return true;
    }
  }
  return false;
}

/**
 * Cast attempts needed for one catch. analysis's `an original routine` subtracts up to
 * five retries along the shared experience curve; for the authored fisher base of five this yields
 * 5 attempts as a novice and 1 once experienced. Tools are intentionally omitted until fishing rods are
 * simulated.
 */
function fishingRetriesFor(plan: PlannerContext, fishGood: number): number {
  const base = workRepeatsFor(plan.ctx, plan.jobType, fishGood);
  const settler = plan.world.tryGet(plan.entity, Settler);
  const track = plan.jobType === null ? undefined : trackFor(plan.ctx, plan.jobType, fishGood);
  // Our save encoding stores `experienceFactor` points per catch. Dividing by the original percentage
  // scale (100), rather than back by the track factor, preserves that factor's authored learning rate:
  // fisher 150 improves half again as quickly as a factor-100 trade.
  const scaledExperience = track === undefined ? 0 : (settler?.experience.get(track.typeId) ?? 0) / 100;
  const learned = Math.floor(fx.toFloat(experienceBonus(scaledExperience)) * 5);
  return Math.max(1, base - learned);
}
