import { JobAssignment } from '../../../components/index.js';
import { carrierCarryCapacity } from '../../progression/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { atOrWalk, startPickup } from '../actions.js';
import type { PlannerContext } from '../planner-context.js';
import { interactionCell, nearestWorkplaceOutput } from '../targets/index.js';
import { boundProducerOutputToHaul, isPorterBoundToStore, nearestGroundPile } from './haul-targets.js';

/**
 * 4. PORTER — a settler bound to a storage fixture (no recipe) that moves loose goods. The full carrier
 * rule ("tragarz"):
 *
 *  - a carrier at a **producing building** (a FARM: no recipe, but produces a field good) HAULS its
 *    finished output OUT to a warehouse ({@link boundProducerOutputToHaul}; the delivery drive then routes
 *    the load to the nearest OTHER store) — "wbity w produkcję ⇒ odnosi do magazynu". Prioritised so the
 *    producer's store keeps clearing to central storage;
 *  - a carrier at ANY bound store (warehouse/HQ, or a farm with nothing to haul out) also BRINGS loose
 *    ground piles IN to it ("przynosi towary"): the counterpart that ferries the goods gatherers drop at a
 *    flag into the store they belong to.
 *
 * A warehouse/HQ carrier only ever reaches the bring-in half (it produces nothing); a production carrier
 * does both, hauling-out first.
 */
export function planPorter(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!isPorterBoundToStore(world, ctx, e)) return false;
  // Haul the bound producer's finished output OUT to a warehouse (a farm's wheat) — the load then routes
  // to storage, never into another producer of the good (deliveryTargetFor case 3).
  const haul = boundProducerOutputToHaul(targets.sinks, world, ctx, e, settler.jobType, settler.tribe);
  if (haul !== null) {
    atOrWalk(world, e, here, interactionCell(world, ctx, terrain, haul.home, here), () =>
      startPickup(
        world,
        ctx,
        e,
        settler,
        haul.home,
        haul.goodType,
        carrierCarryCapacity(world, ctx, settler.tribe),
      ),
    );
    return true;
  }
  // Otherwise bring a loose ground pile IN to the bound store (the warehouse/HQ porter, unchanged).
  const pile = nearestGroundPile(targets.stockpiles, targets.sinks, world, ctx, terrain, here);
  if (pile === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, pile.pile, here), () =>
    startPickup(
      world,
      ctx,
      e,
      settler,
      pile.pile,
      pile.goodType,
      carrierCarryCapacity(world, ctx, settler.tribe),
    ),
  );
  return true;
}

/**
 * 5. STORE-CARRIER HAUL — an **employed carrier** (the transport trade, bound to a building — in
 * practice a warehouse/HQ transport slot; a workshop-bound carrier never falls this far, rung 2a owns
 * it) hauls a finished workplace output to a store, so producing workshops don't clog and goods reach
 * the settlement's stores; the delivery rung then routes the load to ITS bound store when that store
 * can take it. NOBODY else ferries: a settler of another trade with nothing to do idles, and an
 * unemployed or unbound settler does no work at all — transport is a job one is hired for, never a
 * default pastime (observed original behaviour: "bezrobotny to bezrobotny", a carrier works only
 * through its assignment; the JobSystem's report-in pass is what binds a loose carrier to an open
 * transport slot).
 * `anyHaulable` is the planner's per-tick dormancy gate — when nothing is haulable anywhere the
 * per-settler scan is provably null and skipped. Returns false when this settler may not / need not
 * haul (the caller de-stacks it).
 */
export function planCarrierHaul(plan: PlannerContext, anyHaulable: boolean): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  if (!isCarrierJob(ctx, settler.jobType)) return false; // hauling is the carrier trade's job alone
  if (!world.has(e, JobAssignment)) return false; // an unassigned carrier has no store to work for
  const haul = anyHaulable
    ? nearestWorkplaceOutput(targets.stockpiles, targets.sinks, world, ctx, terrain, here)
    : null;
  if (haul === null) return false;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, haul.workplace, here), () =>
    // Lift a batch sized by the tribe's best unlocked vehicle (`stockSlots`), or one unit on foot
    // when no vehicle is available — `pickupFromStore` caps the move to what the source actually holds.
    startPickup(
      world,
      ctx,
      e,
      settler,
      haul.workplace,
      haul.goodType,
      carrierCarryCapacity(world, ctx, settler.tribe),
    ),
  );
  return true;
}
