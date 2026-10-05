import { JobAssignment, Position, Stockpile, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { buildingProduces, isLoosePile, lowestStockedGood } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import { strandedPile } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { deliverableGoodProbe } from './delivery-targets.js';
import { type HaulFlagArea, haulFlagArea } from './haul-flag-area.js';
import { isFarmCarrierHaulOutRole } from './store-policy.js';

/**
 * The nearest ground pile a porter should collect from and the good to lift, or null when none is within
 * reach. A ground pile is an {@link isLoosePile} heap not buried under a building's walls or out of every
 * unit's reach; a wall or road site's delivered material is never one. The good lifted is the pile's
 * lowest-id stocked one, and the scan is canonical by Manhattan distance then ascending cell id. A pile
 * whose good this porter could not deliver is skipped, since lifting it would only make it shed the load
 * at its feet. The pile tests run per candidate, so a lift earlier in the pass is seen by the next porter.
 */
export function nearestGroundPile(
  plan: PlannerContext,
  opts: {
    readonly deliverable: (goodType: number) => boolean;
    /** A flagged carrier's pickup area, ranked from its flag instead of from the carrier. */
    readonly area?: HaulFlagArea | null;
  },
): { pile: Entity; goodType: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const { deliverable, area } = opts;
  const walls = buildingBlockedCells(world, ctx, terrain);
  const best = targets.stockpileCells.nearestLoose(
    here,
    (e) => {
      if (!isLoosePile(world, e)) return null;
      const good = lowestStockedGood(world.get(e, Stockpile));
      if (good === null || !deliverable(good)) return null;
      return strandedPile(world, ctx, terrain, walls, e) ? null : { payload: good };
    },
    area?.gate ?? plan.limit ?? undefined, // the porter's confinement: an out-of-area pile is not one it fetches
    unreachableGoalVeto(world, ctx, plan.entity),
    sameSideAs(world, plan.owner),
    area?.center ?? here,
  );
  return best === null ? null : { pile: best.entity, goodType: best.payload };
}

/**
 * The finished output a carrier bound to a producing building should haul out to a warehouse, or null when
 * there is nothing to haul. A candidate is a good the building's type produces, currently stocks, and this
 * carrier could deliver somewhere; walked in `produces` order, so the pick never depends on store
 * insertion history.
 *
 * Scoped to a bound building whose produced good is field-farmed (a `farming` block), since a recipe
 * workshop's output is already hauled by the producer loop. Keying on the absence of a recipe instead would
 * silently disable this under extracted content, where the pipeline synthesizes a recipe for every
 * producing building. Gated to a non-field-worker so a farmer never lifts the farm's wheat only to bank it
 * straight back.
 */
export function boundProducerOutputToHaul(
  deliverable: (goodType: number) => boolean,
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
): { home: Entity; goodType: number } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  // The role gate is shared with `toStorageOffFarm`, so pickup and delivery routing cannot disagree.
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType)) return null;
  if (!world.has(home, Stockpile) || !world.has(home, Position)) return null;
  const stock = world.get(home, Stockpile).amounts;
  for (const goodType of buildingProduces(world, ctx, home)) {
    if ((stock.get(goodType) ?? 0) <= 0) continue;
    if (deliverable(goodType)) {
      return { home, goodType };
    }
  }
  return null;
}

/**
 * The porter rung's pickup decision, side-effect-free so the dormancy verifier can re-run it without
 * mutating state: the bound producer's output out first, else the nearest deliverable ground pile in,
 * around the porter's flag when it holds one.
 */
export function porterPickupTarget(plan: PlannerContext): { from: Entity; goodType: number } | null {
  const deliverable = deliverableGoodProbe(plan);
  const haul = boundProducerOutputToHaul(deliverable, plan.world, plan.ctx, plan.entity, plan.jobType);
  if (haul !== null) return { from: haul.home, goodType: haul.goodType };
  const pile = nearestGroundPile(plan, { deliverable, area: haulFlagArea(plan) });
  return pile === null ? null : { from: pile.pile, goodType: pile.goodType };
}
