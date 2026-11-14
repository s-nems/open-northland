import { HaulingCart, type HaulingLift } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { isTrader } from '../../../readviews/jobs.js';
import { refillingGoodsOf } from '../../../stores/index.js';
import { boardingNode } from '../../../vehicles/crew.js';
import {
  beginCartLift,
  cartLiftContinues,
  endCartLift,
  haulingCartHolds,
  haulingCartRoom,
  releaseHaulingCart,
  takeHaulingCart,
} from '../../../vehicles/hauling-cart.js';
import { atOrWalk, startCartLoad, startCartUnload, startRefillWait } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, unclaimedStockOf } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { nextLiftBesideCart } from './cart-round.js';
import type { WorkSeatClaims } from './workshop/index.js';

/**
 * HAULING CART - a posted carrier or a trader handed a cart, or a carrier back from a break that parked
 * it, walks to its door and takes it there. In a lift beside the standing cart it plays the next clip, a
 * unit each, and takes the cart up once that lift and any that follows at the same door
 * ({@link nextLiftBesideCart}) is done. One whose hold no longer stands (the post or the trade gone, the
 * cart gone or another player's) sets the cart down and falls through; a door it cannot reach, or one on
 * another continent, gives the cart up where it stands. True while the carrier walks to the cart, lifts
 * beside it or takes it this tick; a carrier with a load in hand delivers first, so the rung only
 * reconciles for it.
 */
export function planHaulingCart(plan: PlannerContext, seatClaims: WorkSeatClaims, loaded: boolean): boolean {
  const { world, ctx, entity: e } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined) return false;
  if (!haulingCartHolds(world, ctx.content, e)) {
    releaseHaulingCart(world, ctx, e);
    return false;
  }
  const trader = isTrader(world, ctx.content, e);
  if (held.lift !== null) {
    if (continueLift(plan, held.lift)) return true;
    const next = trader ? null : nextLiftBesideCart(plan, seatClaims, held.lift);
    endCartLift(world, e);
    if (next !== null) {
      beginCartLift(world, ctx, e, next);
      if (continueLift(plan, next)) return true;
      endCartLift(world, e);
    }
  }
  // A trader's cart standing at a stop stays there while it works the stop; its route takes it up. A
  // trader fetches a cart it is handed with a route unit in hand, which goes into the hold on the take.
  if (held.taken || (loaded && !trader) || (held.parked && trader)) return false;
  return fetchHaulingCart(plan);
}

/** Walk to the standing hauling cart's door and take it up there; a door the puller cannot reach, or one
 *  on another continent, gives the cart up where it stands. True while the puller walks or takes it. A walk
 *  that failed sheds its route before this rung runs again, so the failed-goal memo is what remembers it. */
export function fetchHaulingCart(plan: PlannerContext): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined || held.taken) return false;
  const door = boardingNode(world, ctx, terrain, held.vehicle);
  if (
    door === null ||
    terrain.componentOf(door) !== terrain.componentOf(here) ||
    (door !== here && unreachableGoalVeto(world, ctx, e)?.(door) === true)
  ) {
    releaseHaulingCart(world, ctx, e);
    return false;
  }
  atOrWalk(world, e, here, door, () => takeHaulingCart(world, ctx.content, e));
  return true;
}

/** The next clip of the lift, from the cell it works at; false once there is nothing left to move. A
 *  load claims the units it still means to lift again before each clip, since the clip's pick-up ends
 *  the claim, so another carrier planned meanwhile picks another heap. At a well or hive, whose shelf
 *  holds a unit or two, a load waits out each refill until the cart is full (named addition). */
function continueLift(plan: PlannerContext, lift: HaulingLift): boolean {
  const { world, ctx, terrain, entity: e, here, supply } = plan;
  const offers = (from: Entity, goodType: number): number =>
    unclaimedStockOf(world, ctx, supply, from, goodType);
  const supplies = (from: Entity, goodType: number): boolean =>
    offers(from, goodType) > 0 || refillingGoodsOf(world, ctx, from).includes(goodType);
  if (!cartLiftContinues(world, ctx, e, lift, supplies)) return false;
  const shelved = lift.kind === 'load' ? offers(lift.from, lift.goodType) : 0;
  if (lift.kind === 'load') {
    const amount = Math.min(lift.units, haulingCartRoom(world, ctx.content, e), shelved);
    supply.stampPickupClaim(e, { source: lift.from, goodType: lift.goodType, amount });
  }
  const at = lift.kind === 'load' ? lift.from : lift.store;
  const cell = interactionCell(world, ctx, terrain, at, here);
  atOrWalk(world, e, here, cell, () => {
    if (lift.kind === 'unload') startCartUnload(world, ctx, e, plan, lift.store, lift.goodType);
    else if (shelved > 0) {
      startCartLoad(world, ctx, e, plan, lift.from, lift.goodType, lift.units);
    } else startRefillWait(world, ctx, e);
  });
  return true;
}
