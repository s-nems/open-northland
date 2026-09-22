import { FishSwarm, JobAssignment, Position, Settler } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { fx } from '../../../../core/fixed.js';
import type { Entity } from '../../../../ecs/world.js';
import { hexDistance, hexNeighboursOf, nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { FISH_CAST_ATOMIC, FISH_SHORE_SEARCH_RADIUS } from '../../../economy/fish.js';
import { dynamicBlockOverlay, routeRegions } from '../../../footprint/index.js';
import { experienceBonus, trackFor, workRepeatsFor } from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { edibleGoodFormOf } from '../../../readviews/food.js';
import { isFisherJob } from '../../../readviews/index.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import { closer, manhattan, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../spatial/metric.js';
import { atOrWalk, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { unreachableWorkCell } from '../../targets/index.js';
import { unreachableGoals } from '../../unreachable-goals.js';
import { hasRoom, isStorageSink } from './store-policy.js';

interface FishingTarget {
  readonly entity: Entity;
  readonly shore: NodeId;
  readonly water: NodeId;
  readonly dist: number;
}

/** Plan the land fisher onto a nearby reachable shore from which an authored swarm is in range. */
export function planFisher(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: fisher, here } = plan;
  if (!isFisherJob(ctx.content, plan.jobType)) return false;
  const fishGood = contentIndex(ctx.content).goodTypeBySlug.get('fish');
  if (fishGood === undefined) return false;
  if (!workplaceCanBankCatch(plan, edibleGoodFormOf(ctx.content, fishGood))) return false;

  const gates = {
    terrain,
    blocked: dynamicBlockOverlay(world, ctx, terrain),
    memo: unreachableGoals(world, ctx, fisher),
  };
  const regions = routeRegions(world, ctx, terrain);
  const candidates = nearbyFishingTargets(plan, gates, regions);
  let best: FishingTarget | null = null;
  for (const candidate of candidates) {
    if (best === null || closer(candidate.dist, candidate.shore, best.dist, best.shore)) best = candidate;
  }
  if (best === null && terrain.waterContinents === undefined && terrain.landVertices === undefined) {
    best = syntheticFishingTarget(plan, gates, regions);
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
        water: best.water,
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
 * The original's shore search for fishing searches outward from the fisher and retains at most eight
 * reachable land points beside water. We do that scan once per fisher, then pick its canonical nearest result
 * rather than the original's random candidate.
 */
function nearbyFishingTargets(
  plan: PlannerContext,
  gates: Parameters<typeof unreachableWorkCell>[0],
  regions: ReturnType<typeof routeRegions>,
): FishingTarget[] {
  const { terrain, here } = plan;
  const origin = terrain.coordsOf(here);
  const found: FishingTarget[] = [];
  for (let radius = 0; radius <= FISH_SHORE_SEARCH_RADIUS; radius++) {
    const count = ringOffsetCount(radius);
    for (let i = 0; i < count; i++) {
      const x = origin.x + ringOffsetDx(radius, i);
      const y = origin.y + ringOffsetDy(radius, i);
      if (!terrain.inBounds(x, y)) continue;
      const shore = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(shore)) continue;
      if (plan.limit !== null && !plan.limit.allowsNode(shore)) continue;
      if (unreachableWorkCell(gates, here, shore) || regions.unroutable(here, shore)) continue;
      const target = fishAtWaterEdge(plan, x, y);
      if (target !== null) {
        found.push({ ...target, shore, dist: manhattan(terrain, here, shore) });
        if (found.length === 8) return found;
      }
    }
  }
  return found;
}

function fishAtWaterEdge(
  plan: PlannerContext,
  shoreX: number,
  shoreY: number,
): Pick<FishingTarget, 'entity' | 'water'> | null {
  const { world, terrain } = plan;
  let best: { entity: Entity; water: NodeId; distance: number; swarmNode: NodeId } | null = null;
  for (const water of hexNeighboursOf(shoreX, shoreY)) {
    if (!terrain.inBounds(water.hx, water.hy)) continue;
    const waterNode = terrain.nodeAt(water.hx, water.hy);
    const isWater =
      !terrain.isWalkable(waterNode) &&
      (terrain.landVertices === undefined || terrain.landVertices[waterNode] !== true);
    if (!isWater) continue;
    const continent = terrain.waterContinents?.[waterNode];
    for (const entity of fishSwarmsNearNode(world, water.hx, water.hy, FISH_SHORE_SEARCH_RADIUS - 1)) {
      const swarm = world.get(entity, FishSwarm);
      if (swarm.count <= 0 || (continent !== undefined && swarm.continent !== continent)) continue;
      const at = world.get(entity, Position);
      const point = nodeOfPosition(at.x, at.y);
      const distance = hexDistance(water, point);
      if (distance >= FISH_SHORE_SEARCH_RADIUS) continue;
      const swarmNode = terrain.nodeAtClamped(point.hx, point.hy);
      if (
        best === null ||
        closer(distance, swarmNode, best.distance, best.swarmNode) ||
        (distance === best.distance && swarmNode === best.swarmNode && entity < best.entity)
      ) {
        best = { entity, water: waterNode, distance, swarmNode };
      }
    }
  }
  return best === null ? null : { entity: best.entity, water: best.water };
}

/** Compatibility path for mapless/synthetic terrain fixtures which author swarms without water lanes. */
function syntheticFishingTarget(
  plan: PlannerContext,
  gates: Parameters<typeof unreachableWorkCell>[0],
  regions: ReturnType<typeof routeRegions>,
): FishingTarget | null {
  const { world, terrain, here } = plan;
  const at = terrain.coordsOf(here);
  let best: FishingTarget | null = null;
  for (const entity of fishSwarmsNearNode(world, at.x, at.y, 2 * FISH_SHORE_SEARCH_RADIUS)) {
    const swarm = world.get(entity, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    const shore = swarm.shore;
    const dist = manhattan(terrain, here, shore);
    if (dist > FISH_SHORE_SEARCH_RADIUS) continue;
    if (plan.limit !== null && !plan.limit.allowsNode(shore)) continue;
    if (unreachableWorkCell(gates, here, shore) || regions.unroutable(here, shore)) continue;
    const position = world.get(entity, Position);
    const point = nodeOfPosition(position.x, position.y);
    const water = terrain.nodeAtClamped(point.hx, point.hy);
    const candidate = { entity, shore, water, dist };
    if (best === null || closer(dist, shore, best.dist, best.shore)) best = candidate;
  }
  return best;
}

function workplaceCanBankCatch(plan: PlannerContext, goodType: number): boolean {
  const { world, ctx, entity } = plan;
  const workplace = world.tryGet(entity, JobAssignment)?.workplace;
  if (workplace === undefined) return true;
  return (
    world.isAlive(workplace) &&
    isStorageSink(world, ctx, workplace) &&
    hasRoom(world, ctx, workplace, goodType)
  );
}

/**
 * Cast attempts needed for one catch. The original's needed-retries calculation subtracts up to
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
