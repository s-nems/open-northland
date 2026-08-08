import { Building, JobAssignment, Position, Stockpile, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { buildingProduces, lowestStockedGood } from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import { buriedUnderBuilding, interactionCell, nearestByCell } from '../../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../../unreachable-goals.js';
import { deliverableGoodProbe } from './delivery-targets.js';
import { isFarmCarrierHaulOutRole } from './store-policy.js';

/**
 * The nearest ground pile a porter should collect from and the good to lift, or null when none is within
 * reach. A ground pile is a positioned `Stockpile` with no `Building`; the good lifted is its lowest-id
 * stocked one, and the scan is canonical by Manhattan distance then ascending cell id. A pile whose good
 * this porter could not deliver is skipped, since lifting it would only make it shed the load at its feet.
 *
 * The same-side gate stays even though a ground heap is never owner-stamped: a boat hull is a positioned
 * building-less stockpile too, so without it a porter would unload a rival's ship.
 */
export function nearestGroundPile(
  plan: PlannerContext,
  opts: { readonly deliverable: (goodType: number) => boolean },
): { pile: Entity; goodType: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const { deliverable } = opts;
  const gate = plan.limit ?? undefined; // the porter's confinement: an out-of-area pile is not one it fetches
  const walls = buildingBlockedCells(world, ctx, terrain);
  const memo = unreachableGoals(world, ctx, plan.entity);
  const best = nearestByCell(
    terrain,
    targets.stockpiles,
    here,
    (e) => {
      if (world.has(e, Building)) return null;
      if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
      const good = lowestStockedGood(world.get(e, Stockpile));
      if (good === null) return null;
      if (!deliverable(good)) return null;
      if (buriedUnderBuilding(world, terrain, walls, e)) return null;
      const cell = interactionCell(world, ctx, terrain, e, here);
      if (cell !== here && isUnreachableGoal(memo, cell)) return null;
      if (gate !== undefined && !gate.allowsNode(cell)) return null;
      return { cell, payload: good };
    },
    sameSideAs(world, plan.owner),
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
  tribe: number,
): { home: Entity; goodType: number } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  // The role gate is shared with `toStorageOffFarm`, so pickup and delivery routing cannot disagree.
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe)) return null;
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
 * mutating state: the bound producer's output out first, else the nearest deliverable ground pile in.
 */
export function porterPickupTarget(plan: PlannerContext): { from: Entity; goodType: number } | null {
  const deliverable = deliverableGoodProbe(plan);
  const haul = boundProducerOutputToHaul(
    deliverable,
    plan.world,
    plan.ctx,
    plan.entity,
    plan.jobType,
    plan.tribe,
  );
  if (haul !== null) return { from: haul.home, goodType: haul.goodType };
  const pile = nearestGroundPile(plan, { deliverable });
  return pile === null ? null : { from: pile.pile, goodType: pile.goodType };
}
