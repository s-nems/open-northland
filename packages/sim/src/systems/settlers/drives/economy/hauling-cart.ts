import { Carrying, HaulingCart, type HaulingLift } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { collectStandOf } from '../../../footprint/index.js';
import { isTrader } from '../../../readviews/jobs.js';
import { refillingGoodsOf } from '../../../stores/index.js';
import { boardingNode } from '../../../vehicles/crew.js';
import {
  beginCartLift,
  carriesBetweenCartAndDoor,
  cartLiftContinues,
  cartWorkNode,
  endCartLift,
  handsStowInCart,
  haulingCartHolds,
  haulingCartRoom,
  releaseHaulingCart,
  takeHaulingCart,
} from '../../../vehicles/hauling-cart.js';
import {
  atOrWalk,
  startCartFetch,
  startCartLoad,
  startCartStow,
  startCartUnload,
  startRefillWait,
} from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, unclaimedStockOf } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { nextLiftBesideCart } from './cart-round.js';
import type { WorkSeatClaims } from './workshop/index.js';

/**
 * HAULING CART - a posted carrier or a trader handed a cart, or a carrier back from a break that parked
 * it, walks to the node it works the cart from and takes it there. In a lift with the standing cart it moves the next unit, at a
 * house carrying it between the cart and the door, and takes the cart up once that lift and any that
 * follows at the same door ({@link nextLiftBesideCart}) is done. One whose hold no longer stands (the post or the trade gone, the
 * cart gone or another player's) sets the cart down and falls through; a door it cannot reach, or one on
 * another continent, gives the cart up where it stands. True while the carrier walks to the cart, lifts
 * with it or takes it this tick; a carrier handed a cart with a load in hand delivers first, so the rung
 * only reconciles for it.
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
  // A carrier left holding a unit beside the cart it stood, one a store refused or one a break cut off
  // from its lift, sets it back into the cart before anything else.
  if (!trader && held.parked && stowAtCart(plan)) return true;
  // A trader's cart standing at a stop stays there while it works the stop; its route takes it up. A
  // trader fetches a cart it is handed with a route unit in hand, which goes into the hold on the take.
  if (held.taken || (loaded && !trader) || (held.parked && trader)) return false;
  return fetchHaulingCart(plan);
}

/**
 * The node the puller works its standing hauling cart from ({@link cartWorkNode}), or else its door, or
 * null with the cart given up where it stands: the node gone, on another continent, or one a walk failed
 * to reach. A walk that failed sheds its route before the planner runs again, so the failed-goal memo is
 * what remembers it.
 */
function cartWorkNodeOrRelease(plan: PlannerContext, vehicle: Entity): NodeId | null {
  const { world, ctx, terrain, entity: e, here } = plan;
  const node = cartWorkNode(world, ctx, terrain, vehicle) ?? boardingNode(world, ctx, terrain, vehicle);
  if (
    node !== null &&
    terrain.componentOf(node) === terrain.componentOf(here) &&
    (node === here || unreachableGoalVeto(world, ctx, e)?.(node) !== true)
  ) {
    return node;
  }
  releaseHaulingCart(world, ctx, e);
  return null;
}

/** Walk to the standing hauling cart and take it up there; a cart the puller cannot reach gives
 *  the cart up ({@link cartWorkNodeOrRelease}). True while the puller walks or takes it. */
export function fetchHaulingCart(plan: PlannerContext): boolean {
  const { world, ctx, entity: e, here } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined || held.taken) return false;
  const node = cartWorkNodeOrRelease(plan, held.vehicle);
  if (node === null) return false;
  atOrWalk(world, e, here, node, () => takeHaulingCart(world, ctx.content, e));
  return true;
}

/** Walk to the standing hauling cart and set what the hands hold into its hold there. False with
 *  nothing in hand the hold has a line for, the cart not standing, or its work node out of reach, which gives
 *  the cart up. */
export function stowAtCart(plan: PlannerContext): boolean {
  const { world, ctx, entity: e, here } = plan;
  if (!handsStowInCart(world, ctx.content, e)) return false;
  const vehicle = world.get(e, HaulingCart).vehicle;
  const node = cartWorkNodeOrRelease(plan, vehicle);
  if (node === null) return false;
  atOrWalk(world, e, here, node, () => startCartStow(world, ctx, e, plan, vehicle));
  return true;
}

/** Walk to the standing hauling cart and lift one unit of `goodType` out of its hold there. False
 *  with the cart not standing, or its work node out of reach, which gives the cart up. */
export function fetchAtCart(plan: PlannerContext, goodType: number): boolean {
  const { world, ctx, entity: e, here } = plan;
  const held = world.tryGet(e, HaulingCart);
  if (held === undefined || held.taken) return false;
  const node = cartWorkNodeOrRelease(plan, held.vehicle);
  if (node === null) return false;
  atOrWalk(world, e, here, node, () => startCartFetch(world, ctx, e, plan, held.vehicle, goodType));
  return true;
}

/** The next clip of the lift, from the cell it works at; false once there is nothing left to move. A
 *  load claims the units it still means to lift again before each clip, since the clip's pick-up ends
 *  the claim, so another carrier planned meanwhile picks another heap. At a well or hive, whose shelf
 *  holds a unit or two, a load waits out each refill until the cart is full (named addition). At a house
 *  the carrier carries each unit between the cart and the door ({@link carriesBetweenCartAndDoor}). */
function continueLift(plan: PlannerContext, lift: HaulingLift): boolean {
  const { world, ctx, terrain, entity: e, here, supply } = plan;
  const viaDoor = carriesBetweenCartAndDoor(world, lift.kind === 'load' ? lift.from : lift.store);
  const offers = (from: Entity, goodType: number): number =>
    unclaimedStockOf(world, ctx, supply, from, goodType);
  /** Claim again what the load still means to lift off the shelf, and say how much the shelf offers. */
  const claimRest = (): number => {
    if (lift.kind !== 'load') return 0;
    const shelved = offers(lift.from, lift.goodType);
    const amount = Math.min(lift.units, haulingCartRoom(world, ctx.content, e), shelved);
    if (amount > 0) supply.stampPickupClaim(e, { source: lift.from, goodType: lift.goodType, amount });
    return shelved;
  };
  // A unit lifted inside goes into the cart before the next one, the lift's last unit included; the rest
  // stays claimed for the walk to the cart and back.
  if (viaDoor && lift.kind === 'load' && handsStowInCart(world, ctx.content, e)) {
    claimRest();
    if (stowAtCart(plan)) return true;
  }
  const supplies = (from: Entity, goodType: number): boolean =>
    offers(from, goodType) > 0 || refillingGoodsOf(world, ctx, from).includes(goodType);
  if (!cartLiftContinues(world, ctx, e, lift, supplies)) return false;
  const shelved = claimRest();
  if (viaDoor && lift.kind === 'unload') {
    const inHand = world.tryGet(e, Carrying);
    if (inHand === undefined || inHand.amount <= 0) return fetchAtCart(plan, lift.goodType);
    if (inHand.goodType !== lift.goodType) return stowAtCart(plan);
  }
  const cell =
    lift.kind === 'load'
      ? (collectStandOf(world, ctx, terrain, lift.from) ??
        interactionCell(world, ctx, terrain, lift.from, here))
      : interactionCell(world, ctx, terrain, lift.store, here);
  atOrWalk(world, e, here, cell, () => {
    if (lift.kind === 'unload') startCartUnload(world, ctx, e, plan, lift.store, lift.goodType);
    else if (shelved > 0) {
      startCartLoad(world, ctx, e, plan, lift.from, lift.goodType, lift.units);
    } else startRefillWait(world, ctx, e);
  });
  return true;
}
