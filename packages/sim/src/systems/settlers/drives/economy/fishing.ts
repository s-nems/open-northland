import { FishSwarm, Settler } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { fx } from '../../../../core/fixed.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { FISH_CAST_ATOMIC, FISH_SHORE_SEARCH_RADIUS } from '../../../economy/fish.js';
import { dynamicBlockOverlay, routeRegions } from '../../../footprint/index.js';
import { experienceBonus, trackFor, workRepeatsFor } from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { isFisherJob } from '../../../readviews/index.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import { closer, manhattan } from '../../../spatial/metric.js';
import { atOrWalk, startAtomic } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { unreachableWorkCell } from '../../targets/index.js';
import { unreachableGoals } from '../../unreachable-goals.js';

/** Plan the land fisher onto the nearest reachable authored swarm's shore. */
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
    const shore = swarm.shore;
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
