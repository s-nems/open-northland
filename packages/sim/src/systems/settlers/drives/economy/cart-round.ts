import {
  Building,
  Carrying,
  type HaulingLift,
  JobAssignment,
  prioritizesGood,
  Stockpile,
  sameSideAs,
} from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { manhattan } from '../../../spatial/metric.js';
import { bankedSlot, isCarrierJob, isLoosePile, lowestStockedGood } from '../../../stores/index.js';
import {
  handHaulingCartGood,
  haulingCartGoods,
  haulingCartRoom,
  haulingCartTakes,
  haulingCartUnits,
  pullsHaulingCart,
} from '../../../vehicles/hauling-cart.js';
import { walkFetchInput, walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  boundWorkplaceTarget,
  haulableOutputGood,
  interactionCell,
  type Qualified,
  qualifiedGood,
  strandedPile,
  unclaimedGoodsAt,
} from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { stampDeliveryErrand } from './delivery.js';
import { carriedGoodForm, deliveryTargetFor, homeBoundGoodProbe } from './delivery-targets.js';
import { workAreaGate } from './haul-flag-area.js';
import { nearestLoosePickup, porterLoadOf, roomLeftForPorters } from './haul-targets.js';
import { isBoundToStorageSink } from './store-policy.js';
import { type CartPickup, workshopCartPickup } from './workshop/cart-supply.js';
import { stampInputErrand, type WorkSeatClaims } from './workshop/index.js';

/**
 * How far around a store's porter with a part-loaded cart a heap or finished output outside its own
 * pickup area is still lifted before the trip home, in half-cell nodes: a few cells, the spread of the
 * heaps a producer drops around its hut. Named approximation: far enough to clear one yard in a trip, too
 * short to cross a village for a second one.
 */
export const CART_TOP_UP_REACH = 12;

/**
 * CART ROUND - a posted carrier whose cart has room left after a lift fills it before it delivers, with
 * whatever goods its post moves (named addition). A store's porter sweeps its pickup area, nearest heap
 * first from where it stands, then a heap or finished output within {@link CART_TOP_UP_REACH} of it, only
 * goods its own store still has room for. A workshop's carrier fetching inputs goes on to the next
 * source while an input is short of its slot, what is aboard counted, unless a product waits on the
 * load. True while the carrier walks to or lifts the next stop; with nothing more to take it delivers
 * what it has.
 */
export function planCartRound(plan: PlannerContext, seatClaims: WorkSeatClaims): boolean {
  if (!pullsHaulingCart(plan.world, plan.entity)) return false;
  const next = nextCartPickup(plan, seatClaims, null);
  if (next === null) return false;
  if (next.supplies === null) {
    walkPickupBatch(plan, next.from, next.goodType, undefined, next.units);
    return true;
  }
  stampInputErrand(plan, seatClaims, next.supplies, next.goodType, next.units);
  walkFetchInput(plan, next.from, next.goodType, next.refills, next.units);
  return true;
}

/**
 * The lift that follows `ended` beside the cart still standing there, so the carrier does not take the
 * cart up between two lifts at one door: another good off the same source, or another good of the hold
 * bound for the same store, a refused good's lift ended first. Null when the cart is to be taken up.
 */
export function nextLiftBesideCart(
  plan: PlannerContext,
  seatClaims: WorkSeatClaims,
  ended: HaulingLift,
): HaulingLift | null {
  const { world, entity: e } = plan;
  if (ended.kind === 'unload') {
    for (const goodType of haulingCartGoods(world, e)) {
      if (goodType === ended.goodType || deliveryTargetFor(plan, goodType) !== ended.store) continue;
      stampDeliveryErrand(plan, ended.store, goodType, haulingCartUnits(world, e, goodType));
      return { kind: 'unload', store: ended.store, goodType, refused: false };
    }
    return null;
  }
  const next = nextCartPickup(plan, seatClaims, ended.from);
  if (next === null || next.from !== ended.from || next.goodType === ended.goodType) return null;
  if (next.supplies !== null) stampInputErrand(plan, seatClaims, next.supplies, next.goodType, next.units);
  return { kind: 'load', from: next.from, goodType: next.goodType, units: next.units };
}

/**
 * The load the delivery rung routes for a carrier with its cart in hand. Of a mixed load it is the good
 * whose store lies nearest, handed up from the hold in place of the one in hand, so the cart empties
 * door by door and a good no store takes never holds the rest back; the good in hand wins a tie.
 */
export function routableCartLoad(
  plan: PlannerContext,
  load: { goodType: number; amount: number },
): { goodType: number; amount: number } {
  const { world, ctx, terrain, entity: e, here } = plan;
  if (!pullsHaulingCart(world, e)) return load;
  const goods = haulingCartGoods(world, e);
  if (goods.length <= 1) return load;
  let nearest = load.goodType;
  let nearestSteps = Number.POSITIVE_INFINITY;
  for (const goodType of goods) {
    const store = deliveryTargetFor(plan, goodType);
    if (store === null) continue;
    const steps = manhattan(terrain, here, interactionCell(world, ctx, terrain, store, here));
    if (steps < nearestSteps || (steps === nearestSteps && goodType === load.goodType)) {
      nearest = goodType;
      nearestSteps = steps;
    }
  }
  if (nearest === load.goodType || !handHaulingCartGood(world, ctx.content, e, nearest)) return load;
  return world.tryGet(e, Carrying) ?? load;
}

/** The next stop of the cart's round for the carrier's post, or null with the cart full or nothing more
 *  to take. `beside` is the source the cart stands at after a lift, null with the cart in hand. Only
 *  goods the hold has a line for mix: a good that rides in the hands is delivered on its own. */
function nextCartPickup(
  plan: PlannerContext,
  seatClaims: WorkSeatClaims,
  beside: Entity | null,
): CartPickup | null {
  const { world, ctx, entity: e } = plan;
  if (!isCarrierJob(ctx, plan.jobType)) return null;
  const room = haulingCartRoom(world, ctx.content, e);
  if (room <= 0) return null;
  const inHand = world.tryGet(e, Carrying);
  if (inHand !== undefined && !haulingCartTakes(world, ctx.content, e, inHand.goodType)) return null;
  const mixes = (goodType: number): boolean =>
    haulingCartTakes(world, ctx.content, e, carriedGoodForm(world, ctx, e, goodType));
  if (isBoundToStorageSink(world, ctx, e)) return storeCartPickup(plan, room, mixes);
  const workplace = boundWorkplaceTarget(world, ctx, e, plan.jobType, plan.tribe);
  if (workplace === null) return null;
  return workshopCartPickup(plan, workplace, seatClaims, beside, room, mixes);
}

/** A store's porter: the nearest heap of its own pickup area, else a heap or finished output close by. */
function storeCartPickup(
  plan: PlannerContext,
  room: number,
  mixes: (goodType: number) => boolean,
): CartPickup | null {
  const { world, ctx, terrain, here, targets, supply } = plan;
  const home = world.tryGet(plan.entity, JobAssignment)?.workplace;
  if (home === undefined) return null;
  const homeBound = homeBoundGoodProbe(plan);
  const roomAtHome = (goodType: number): number =>
    mixes(goodType) && homeBound(goodType) ? roomAtHomeFor(plan, home, goodType) : 0;
  const wanted = (goodType: number): boolean => roomAtHome(goodType) > 0;
  const pickup = (from: Entity, goodType: number): CartPickup => ({
    from,
    goodType,
    units: Math.min(room, roomAtHome(goodType)),
    refills: false,
    supplies: null,
  });
  const inArea = nearestLoosePickup(plan, wanted, here);
  if (inArea !== null) return pickup(inArea.from, inArea.goodType);

  const walls = buildingBlockedCells(world, ctx, terrain);
  const closeBy = (candidate: Entity): Qualified<number> | null => {
    if (world.has(candidate, Building)) {
      return qualifiedGood(haulableOutputGood(world, ctx, supply, wanted, candidate));
    }
    if (!isLoosePile(world, candidate) || !world.has(candidate, Stockpile)) return null;
    const unclaimed = unclaimedGoodsAt(world, ctx, supply, candidate);
    const good = lowestStockedGood(
      world.get(candidate, Stockpile),
      (g) => (unclaimed?.(g) ?? true) && wanted(g),
    );
    if (good === null) return null;
    return strandedPile(world, ctx, terrain, walls, candidate) ? null : { payload: good };
  };
  const found = targets.stockpileCells.nearest(
    here,
    closeBy,
    workAreaGate(terrain, here, CART_TOP_UP_REACH, plan.limit),
    unreachableGoalVeto(world, ctx, plan.entity),
    sameSideAs(world, plan.owner),
  );
  return found === null ? null : pickup(found.entity, found.payload);
}

/**
 * The units of `goodType` the porter's own store still takes past what its cart already carries: the
 * shelf's room, and for a good the store marks as priority the room its fellow porters' loads leave, so
 * a round never undoes the priority rung's capped lift nor brings home more than the shelf holds.
 */
function roomAtHomeFor(plan: PlannerContext, home: Entity, goodType: number): number {
  const { world, ctx, entity: e } = plan;
  const carried = carriedGoodForm(world, ctx, e, goodType);
  const slot = bankedSlot(world, ctx, home, carried);
  const shelf =
    slot.capacity -
    (world.get(home, Stockpile).amounts.get(slot.goodType) ?? 0) -
    haulingCartUnits(world, e, carried);
  if (!prioritizesGood(world, home, carried)) return shelf;
  return Math.min(shelf, roomLeftForPorters(plan, home, carried) - porterLoadOf(world, e, carried));
}
