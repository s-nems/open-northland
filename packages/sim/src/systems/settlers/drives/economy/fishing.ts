import { footprintCellDx } from '@open-northland/data';
import { FishSwarm, JobAssignment, Position } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import {
  HEX_NEIGHBOUR_OFFSETS,
  hexDistance,
  nodeHxOfPosition,
  nodeHyOfPosition,
  nodeOfPosition,
} from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { FISH_CAST_ATOMIC, FISH_SHORE_SEARCH_RADIUS, fishGoodOf } from '../../../economy/fish.js';
import { gatherGoodOpen } from '../../../economy/gather-goods.js';
import { liveFlagOf } from '../../../economy/work-flag.js';
import { toolWorkFactorPct } from '../../../equipment/index.js';
import { dynamicBlockOverlay, routeRegions } from '../../../footprint/index.js';
import { jobExperiencePercent, strokesPerUnit, workRepeatsFor } from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { edibleGoodFormOf } from '../../../readviews/food.js';
import { isFisherJob } from '../../../readviews/index.js';
import { fishSwarmsNearNode, visitFishSwarmsNear } from '../../../spatial/fish.js';
import { closer, manhattan, ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../spatial/metric.js';
import { entityNode } from '../../../spatial/nodes.js';
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

/**
 * Plan the land fisher onto a reachable shore near his {@link shoreSearchOrigin} from which an authored
 * swarm is in range, while its production counter for the raw fish lets it fish.
 */
export function planFisher(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: fisher, here } = plan;
  if (!isFisherJob(ctx.content, plan.jobType)) return false;
  const fishGood = fishGoodOf(ctx.content);
  if (fishGood === undefined || !gatherGoodOpen(world, ctx, fisher, plan.jobType, fishGood)) return false;
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
  if (best === null && terrain.waterContinents === undefined && terrain.groundKinds === undefined) {
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
 * Where the fisher's shore search starts: his own flag while he holds a live one, the catch-delivery flag
 * or the one his post took, else his own feet. Authored: the flag is the water he was sent to, so a man back
 * from a meal, a nap or a trip to his workplace returns to it instead of idling wherever he stands, out of
 * reach of any shore. Routability is still judged from his feet.
 */
function shoreSearchOrigin(plan: PlannerContext): NodeId {
  const { world, terrain, entity, here } = plan;
  const flag = liveFlagOf(world, entity);
  return flag === undefined ? here : entityNode(world, terrain, flag.flag);
}

/**
 * The original's shore search for fishing searches outward from the fisher and retains at most eight
 * reachable land points beside water. We do that scan once per fisher, from his {@link shoreSearchOrigin},
 * then pick its canonical nearest result rather than the original's random candidate.
 */
function nearbyFishingTargets(
  plan: PlannerContext,
  gates: Parameters<typeof unreachableWorkCell>[0],
  regions: ReturnType<typeof routeRegions>,
): FishingTarget[] {
  const { terrain, here } = plan;
  const from = shoreSearchOrigin(plan);
  const origin = terrain.coordsOf(from);
  const found: FishingTarget[] = [];
  const edge = new WaterEdgeSwarm(plan);
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
      const target = edge.at(x, y);
      if (target !== null) {
        found.push({ ...target, shore, dist: manhattan(terrain, from, shore) });
        if (found.length === 8) return found;
      }
    }
  }
  return found;
}

/**
 * The swarm a shore node fishes: the nearest live one of its water's continent within the search radius of
 * a water node beside it, by (distance, swarm node, id), a total order, so the visit order is free.
 */
class WaterEdgeSwarm {
  private readonly water: { hx: number; hy: number } = { hx: 0, hy: 0 };
  private readonly point: { hx: number; hy: number } = { hx: 0, hy: 0 };
  private waterNode = 0 as NodeId;
  private continent: number | undefined;
  private entity: Entity | null = null;
  private bestWater = 0 as NodeId;
  private distance = 0;
  private swarmNode = 0 as NodeId;

  constructor(private readonly plan: PlannerContext) {}

  at(shoreX: number, shoreY: number): Pick<FishingTarget, 'entity' | 'water'> | null {
    const { world, terrain } = this.plan;
    this.entity = null;
    for (const offset of HEX_NEIGHBOUR_OFFSETS) {
      const hx = shoreX + footprintCellDx(shoreY, offset);
      const hy = shoreY + offset.dy;
      if (!terrain.inBounds(hx, hy)) continue;
      const waterNode = terrain.nodeAt(hx, hy);
      if (!terrain.isWater(waterNode)) continue;
      this.water.hx = hx;
      this.water.hy = hy;
      this.waterNode = waterNode;
      this.continent = terrain.waterContinents?.[waterNode];
      visitFishSwarmsNear(world, hx, hy, FISH_SHORE_SEARCH_RADIUS - 1, this.visit);
    }
    return this.entity === null ? null : { entity: this.entity, water: this.bestWater };
  }

  private readonly visit = (entity: Entity): void => {
    const { world, terrain } = this.plan;
    const swarm = world.get(entity, FishSwarm);
    if (swarm.count <= 0 || (this.continent !== undefined && swarm.continent !== this.continent)) return;
    const at = world.get(entity, Position);
    this.point.hx = nodeHxOfPosition(at.x, at.y);
    this.point.hy = nodeHyOfPosition(at.x, at.y);
    const distance = hexDistance(this.water, this.point);
    if (distance >= FISH_SHORE_SEARCH_RADIUS) return;
    const swarmNode = terrain.nodeAtClamped(this.point.hx, this.point.hy);
    // Strict, so a swarm another water already reached at the same rank keeps that water.
    if (
      this.entity === null ||
      closer(distance, swarmNode, this.distance, this.swarmNode) ||
      (distance === this.distance && swarmNode === this.swarmNode && entity < this.entity)
    ) {
      this.entity = entity;
      this.bestWater = this.waterNode;
      this.distance = distance;
      this.swarmNode = swarmNode;
    }
  };
}

/** Compatibility path for mapless/synthetic terrain fixtures which author swarms without water lanes. */
function syntheticFishingTarget(
  plan: PlannerContext,
  gates: Parameters<typeof unreachableWorkCell>[0],
  regions: ReturnType<typeof routeRegions>,
): FishingTarget | null {
  const { world, terrain, here } = plan;
  const from = shoreSearchOrigin(plan);
  const at = terrain.coordsOf(from);
  let best: FishingTarget | null = null;
  for (const entity of fishSwarmsNearNode(world, at.x, at.y, 2 * FISH_SHORE_SEARCH_RADIUS)) {
    const swarm = world.get(entity, FishSwarm);
    if (swarm.count <= 0 || swarm.shore === null) continue;
    const shore = swarm.shore;
    const dist = manhattan(terrain, from, shore);
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
 * Casts one catch costs this fisher: the trade's `baserepeatcounter` (five for the fisher) under the
 * shared strokes rule, so experience and a tool cut the misses down to a single cast.
 */
function fishingRetriesFor(plan: PlannerContext, fishGood: number): number {
  const { world, ctx, entity: fisher } = plan;
  return strokesPerUnit(
    workRepeatsFor(ctx, plan.jobType, fishGood),
    jobExperiencePercent(world, ctx, fisher, fishGood),
    toolWorkFactorPct(world, ctx, fisher),
  );
}
