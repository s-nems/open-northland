import { HaulingCart, type HaulingLift } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { isTrader } from '../../../readviews/jobs.js';
import { refillingGoodsOf } from '../../../stores/index.js';
import { boardingNode } from '../../../vehicles/crew.js';
import {
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

/**
 * HAULING CART - a posted carrier or a trader handed a cart, or a carrier back from a break that parked
 * it, walks to its door and takes it there; one in a lift beside the standing cart plays the next clip of it, a unit each,
 * and takes the cart up again when the lift is done; one whose hold no longer stands (the post or the
 * trade gone, the cart gone or another player's) sets the cart down and falls through. A door it cannot
 * reach, or one on another continent, gives the cart up where it stands. True while the carrier walks to
 * the cart, lifts beside it or takes it this tick; a carrier with a load in hand delivers first, so the
 * rung only reconciles for it.
 */
export function planHaulingCart(plan: PlannerContext, loaded: boolean): boolean {
  const { world, ctx, entity: e } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined) return false;
  if (!haulingCartHolds(world, ctx.content, e)) {
    releaseHaulingCart(world, ctx, e);
    return false;
  }
  if (held.lift !== null) {
    if (continueLift(plan, held.lift)) return true;
    endCartLift(world, e);
  }
  // A trader's cart standing at a stop stays there while it works the stop; its route takes it up. A
  // trader fetches a cart it is handed with a route unit in hand, which goes into the hold on the take.
  const trader = isTrader(world, ctx.content, e);
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
    if (lift.kind === 'unload') startCartUnload(world, ctx, e, plan, lift.store);
    else if (shelved > 0) {
      startCartLoad(world, ctx, e, plan, lift.from, lift.goodType, lift.units);
    } else startRefillWait(world, ctx, e);
  });
  return true;
}
