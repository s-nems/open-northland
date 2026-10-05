import { Building, JobAssignment, Position, Stockpile, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { buildingProduces, isLoosePile, type SupplyTally } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import { haulableOutputGood, type Qualified, qualifiedGood, strandedPile } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { deliverableGoodProbe } from './delivery-targets.js';
import { haulFlagArea } from './haul-flag-area.js';
import { isFarmCarrierHaulOutRole } from './store-policy.js';

/**
 * The nearest loose pickup a porter should make and the good to lift, or null when none is within reach.
 * Without a flag it is a ground pile, ranked from the porter. With one it is a ground pile or a workplace's
 * finished output inside the flag's area, ranked from the flag. Original behavior: a carrier's search around
 * its work point takes both. Approximation: the original favours a ground heap lying a few steps beyond the
 * nearest such building; here plain distance decides.
 *
 * A ground pile is an {@link isLoosePile} heap not buried under a building's walls or out of every unit's
 * reach; a wall or road site's delivered material is never one. The good lifted is the pile's lowest-id
 * stocked one, and the scan is canonical by Manhattan distance then ascending cell id. A good this porter
 * could not deliver is skipped, since lifting it would only make it shed the load at its feet. The tests
 * run per candidate, so a lift or claim earlier in the pass is seen by the next porter, and a good every
 * unit of which a walker already claimed is passed over.
 */
function nearestLoosePickup(
  plan: PlannerContext,
  deliverable: (goodType: number) => boolean,
): { from: Entity; goodType: number } | null {
  const { world, ctx, terrain, here, targets, supply } = plan;
  const walls = buildingBlockedCells(world, ctx, terrain);
  const groundPileGood = (e: Entity): Qualified<number> | null => {
    if (!isLoosePile(world, e)) return null;
    const good = lowestUnclaimedGood(supply, e, world.get(e, Stockpile).amounts);
    if (good === null || !deliverable(good)) return null;
    return strandedPile(world, ctx, terrain, walls, e) ? null : { payload: good };
  };
  const avoid = unreachableGoalVeto(world, ctx, plan.entity);
  const onSide = sameSideAs(world, plan.owner);
  const area = haulFlagArea(plan);
  const best =
    area === null
      ? targets.stockpileCells.nearestLoose(here, groundPileGood, plan.limit ?? undefined, avoid, onSide)
      : targets.stockpileCells.nearest(
          here,
          (e) =>
            world.has(e, Building)
              ? qualifiedGood(haulableOutputGood(world, ctx, supply, deliverable, e))
              : groundPileGood(e),
          area.gate,
          avoid,
          onSide,
          area.center,
        );
  return best === null ? null : { from: best.entity, goodType: best.payload };
}

function lowestUnclaimedGood(
  supply: SupplyTally,
  pile: Entity,
  amounts: ReadonlyMap<number, number>,
): number | null {
  let lowest: number | null = null;
  for (const [goodType, amount] of amounts) {
    if ((lowest === null || goodType < lowest) && amount > supply.reservedAt(pile, goodType))
      lowest = goodType;
  }
  return lowest;
}

/**
 * The finished output a carrier bound to a producing building should haul out to a warehouse, or null when
 * there is nothing to haul. A candidate is a good the building's type produces, stocks beyond what other
 * settlers walking to it have claimed, and this carrier could deliver somewhere; walked in `produces`
 * order, so the pick never depends on store insertion history.
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
  supply: SupplyTally,
): { home: Entity; goodType: number } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  // The role gate is shared with `toStorageOffFarm`, so pickup and delivery routing cannot disagree.
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType)) return null;
  if (!world.has(home, Stockpile) || !world.has(home, Position)) return null;
  const stock = world.get(home, Stockpile).amounts;
  for (const goodType of buildingProduces(world, ctx, home)) {
    if ((stock.get(goodType) ?? 0) <= supply.reservedAt(home, goodType)) continue;
    if (deliverable(goodType)) {
      return { home, goodType };
    }
  }
  return null;
}

/**
 * The porter rung's pickup decision, side-effect-free so the dormancy verifier can re-run it without
 * mutating state: the bound producer's output out first, else the nearest deliverable loose pickup in.
 */
export function porterPickupTarget(plan: PlannerContext): { from: Entity; goodType: number } | null {
  const deliverable = deliverableGoodProbe(plan);
  const haul = boundProducerOutputToHaul(
    deliverable,
    plan.world,
    plan.ctx,
    plan.entity,
    plan.jobType,
    plan.supply,
  );
  if (haul !== null) return { from: haul.home, goodType: haul.goodType };
  return nearestLoosePickup(plan, deliverable);
}
