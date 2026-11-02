import {
  Carrying,
  StandIn,
  TradeRoute,
  type TradeRouteView,
  TradeShip,
  type TradeStop,
  Vehicle,
} from '../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { hexDistance } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { vehicleAnchor } from '../footprint/index.js';
import { atomicDuration } from '../readviews/animations.js';
import { edibleGoodFormOf } from '../readviews/food.js';
import { atOrWalk, PICKUP_ATOMIC_ID, PILEUP_ATOMIC_ID, startAtomic } from '../settlers/atomics/start.js';
import { fetchHaulingCart } from '../settlers/drives/economy/hauling-cart.js';
import type { PlannerContext } from '../settlers/planner/context.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { boardingNode, pinnedTraderAshore } from '../vehicles/crew.js';
import { haulingCartLiftTicks, parkHaulingCart } from '../vehicles/hauling-cart.js';
import {
  cartStands,
  type FerryHold,
  ferryHoldOf,
  TRADE_CART_HOUSE_DISTANCE,
  type TraderHold,
  traderHoldOf,
} from './hold.js';
import { mooringTargetOfStop, routeCrossesSea, shipLiesOn, stopContinent } from './ship.js';
import { boardTradeShip, shipLiesAwayFrom } from './voyage.js';

/** How close to the ship's boarding node a trader counts as standing at the door: one step, since another
 *  settler on the door leaves it beside it. */
const SHIP_DOOR_REACH = 1;

/** A stop's next action as `drive.ts` decides it; the ferry owns only how it reaches the ship. */
export type StopAction =
  | { readonly kind: 'load'; readonly good: number; readonly from: Entity }
  | { readonly kind: 'unload'; readonly good: number; readonly into: Entity | null }
  | { readonly kind: 'next' }
  | { readonly kind: 'wait' };

/** What the ferry asks of the land trader's rules in `drive.ts`, which stay the one owner of them. */
export interface StopRules {
  /** The action at the current stop, read over `hold`. */
  decide(hold: TraderHold): StopAction;
  /** Whether the route sends the trader to the other stop now: a domestic trader goes once work waits
   *  there, a foreign one as soon as this stop is done. */
  setsOut(hold: TraderHold): boolean;
  /** Move the unit at the stop, through the near hold. */
  work(near: TraderHold, action: Extract<StopAction, { kind: 'load' | 'unload' }>): boolean;
  wait(near: TraderHold): boolean;
}

type WaitRule = Pick<StopRules, 'wait'>;

/** The ship and stops of a trader's crossing route: null unless a pinned ship and a route that crosses. */
export interface SeaLeg {
  readonly ship: Entity;
  readonly stop: DeepReadonly<TradeStop>;
  readonly other: DeepReadonly<TradeStop>;
}

export function seaLegOf(plan: PlannerContext, route: TradeRouteView): SeaLeg | null {
  const { world, ctx, terrain, entity: e } = plan;
  const ship = world.tryGet(e, TradeShip)?.vehicle;
  if (ship === undefined || !routeCrossesSea(world, ctx, terrain, e)) return null;
  const stop = route.stops[route.current];
  const other = route.stops[1 - route.current];
  return stop === undefined || other === undefined ? null : { ship, stop, other };
}

/** A trader standing on the other stop's continent, as a landing or a player's order leaves it, takes
 *  that stop as current. */
export function takeStopAtHand(plan: PlannerContext): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  if (!world.has(e, TradeShip) || !routeCrossesSea(world, ctx, terrain, e)) return;
  const route = world.get(e, TradeRoute);
  const other = route.stops[1 - route.current];
  if (other === undefined || stopContinent(world, ctx, terrain, other) !== terrain.componentOf(here)) return;
  world.mut(e, TradeRoute).current = 1 - route.current;
}

/**
 * A crossing route's work: the land rules decide over the merged hold, this layer takes the near hold to
 * the ship when it fills or lacks a unit, and turns the rules' `next` into a voyage. A ship lying on no
 * shore the trader can walk to leaves it waiting. On a shore that is no stop of its route, or at its
 * stop's shore but away from the mooring, the trader first sails the ship to the stop's mooring.
 */
export function planCrossing(plan: PlannerContext, leg: SeaLeg, near: TraderHold, rules: StopRules): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const { ship, stop, other } = leg;
  const continent = terrain.componentOf(here);
  if (!shipLiesOn(world, ctx, terrain, ship, continent)) return rules.wait(near);
  const hold = ferryHoldOf(world, ctx, near, ship);
  if (hold === null) return rules.wait(near);
  const target = mooringTargetOfStop(world, ctx, terrain, ship, stop);
  if (stopContinent(world, ctx, terrain, stop) !== continent) return setOut(plan, hold, target, false, rules);
  if (shipLiesAwayFrom(world, ctx, terrain, e, ship, target)) return setOut(plan, hold, target, false, rules);

  const action = rules.decide(hold);
  switch (action.kind) {
    case 'wait':
      return rules.wait(near);
    case 'load': {
      const loading = edibleGoodFormOf(ctx.content, action.good);
      const stow = stowableGood(hold, loading);
      if (stow === loading && standsAtShip(plan, ship)) return liftAtShip(plan, hold, stow, 'stow', rules);
      if (near.room > 0) return rules.work(near, action);
      if (stow !== undefined) return liftAtShip(plan, hold, stow, 'stow', rules);
      break;
    }
    case 'unload': {
      const fetch = nextFetch(plan, hold, action.good, rules);
      if (fetch !== undefined) return liftAtShip(plan, hold, fetch, 'fetch', rules);
      if (near.amount(action.good) > 0) return rules.work(near, action);
      // A cart full of goods for the other stop makes room first, a unit a lift.
      const stow = stowableGood(hold);
      if (stow !== undefined) return liftAtShip(plan, hold, stow, 'stow', rules);
      break;
    }
    case 'next':
      break;
  }
  if (!rules.setsOut(hold)) return false;
  return setOut(plan, hold, mooringTargetOfStop(world, ctx, terrain, ship, other), true, rules);
}

/** The near good a lift into the ship moves next, with room there: `first` while the near hold has it,
 *  so a load in hand does not push out a unit still owed, else the first good the ship takes. */
function stowableGood(hold: FerryHold, first?: number): number | undefined {
  if (hold.aboard.room <= 0) return undefined;
  if (first !== undefined && hold.near.amount(first) > 0 && hold.aboard.carries(first)) return first;
  return hold.near.entries.find(([good]) => hold.aboard.carries(good))?.[0];
}

/**
 * The good to lift out of the ship for an `unload` of `good`: that good while the near hold lacks it; and
 * at the door any good aboard this stop unloads, so the cart leaves full rather than with one unit.
 */
function nextFetch(
  plan: PlannerContext,
  hold: FerryHold,
  good: number,
  rules: StopRules,
): number | undefined {
  const { near, aboard } = hold;
  if (near.room <= 0) return undefined;
  if (near.amount(good) <= 0) return aboard.amount(good) > 0 ? good : undefined;
  if (!standsAtShip(plan, hold.ship)) return undefined;
  const entries = hold.entries.filter(([aboardGood]) => aboard.amount(aboardGood) > 0);
  const more = rules.decide({ ...hold, entries });
  return more.kind === 'unload' && aboard.amount(more.good) > 0 ? more.good : undefined;
}

/** Whether the trader stands at the ship's door, where a lift needs no walk. */
function standsAtShip(plan: PlannerContext, ship: Entity): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const door = boardingNode(world, ctx, terrain, ship);
  if (door === null) return false;
  if (world.tryGet(e, StandIn)?.goal === door) return true;
  return nodeDistance(terrain, here, door) <= SHIP_DOOR_REACH;
}

function nodeDistance(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const from = terrain.coordsOf(a);
  const to = terrain.coordsOf(b);
  return hexDistance({ hx: from.x, hy: from.y }, { hx: to.x, hy: to.y });
}

/** Whether the trader's standing cart waits near enough the ship's door to lift with, as at a house. */
function cartStandsAtShip(world: World, near: TraderHold, terrain: TerrainGraph, door: NodeId): boolean {
  if (near.cart === null) return false;
  const at = vehicleAnchor(world, near.cart);
  if (at === null) return false;
  const to = terrain.coordsOf(door);
  return hexDistance(at, { hx: to.x, hy: to.y }) <= TRADE_CART_HOUSE_DISTANCE;
}

/** Whether a walk to the boarding node failed lately, which the trader waits out rather than searching
 *  the same path on every stranded retry. */
function failedToReachDoor(plan: PlannerContext, door: NodeId): boolean {
  return isUnreachableGoal(unreachableGoals(plan.world, plan.ctx, plan.entity), door);
}

/** Move one unit between the near hold and the ship at its door: a cart standing away is taken up first,
 *  one in hand is stood beside the door on arrival. */
function liftAtShip(
  plan: PlannerContext,
  hold: FerryHold,
  good: number,
  way: 'stow' | 'fetch',
  rules: WaitRule,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const { near, ship } = hold;
  const door = boardingNode(world, ctx, terrain, ship);
  if (door === null || failedToReachDoor(plan, door)) return rules.wait(near);
  if (cartStands(world, near) && !cartStandsAtShip(world, near, terrain, door)) return fetchHaulingCart(plan);
  atOrWalk(world, e, here, door, () => {
    parkHaulingCart(world, ctx, e);
    const atomicId = way === 'stow' ? PILEUP_ATOMIC_ID : PICKUP_ATOMIC_ID;
    startAtomic(
      world,
      e,
      atomicId,
      way === 'stow'
        ? { kind: 'tradeShipStow', vehicle: ship, goodType: good }
        : { kind: 'tradeShipFetch', vehicle: ship, goodType: good },
      haulingCartLiftTicks(world, ctx.content, e, atomicDuration(ctx.content, plan, atomicId)),
      ship,
    );
  });
  return true;
}

/**
 * Take the ship to `target`, aboard through {@link goAboard}. `flips` is a departure for the other stop.
 * A failed dock's cooldown or no shore to sail to keep the trader ashore.
 */
function setOut(
  plan: PlannerContext,
  hold: FerryHold,
  target: NodeId | null,
  flips: boolean,
  rules: StopRules,
): boolean {
  const cooling = plan.ctx.tick < plan.world.get(plan.entity, TradeShip).dockRetryAt;
  if (target === null || cooling) return rules.wait(hold.near);
  return goAboard(plan, hold, flips, rules);
}

/**
 * The trader goes aboard: units in bare hands go into the ship first, goods in a cart stay in the cart,
 * which is brought to the door and set into the vehicle slot. `flips` turns the route at the door. No
 * slot for the cart keeps the trader ashore.
 */
function goAboard(plan: PlannerContext, hold: FerryHold, flips: boolean, rules: WaitRule): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const { near, ship } = hold;
  if (near.cart !== null && !world.get(ship, Vehicle).vehicles.includes(null)) return rules.wait(near);
  if (near.cart === null && near.load > 0) {
    const stow = stowableGood(hold);
    if (stow !== undefined) return liftAtShip(plan, hold, stow, 'stow', rules);
  }
  const door = boardingNode(world, ctx, terrain, ship);
  if (door === null || failedToReachDoor(plan, door)) return rules.wait(near);
  if (cartStands(world, near) && !cartStandsAtShip(world, near, terrain, door)) return fetchHaulingCart(plan);
  atOrWalk(world, e, here, door, () => {
    if (flips) world.mut(e, TradeRoute).current = 1 - world.get(e, TradeRoute).current;
    boardTradeShip(world, e, ship);
  });
  return true;
}

/**
 * An order held on the pinned ship calls its trader aboard ahead of everything the route would do, a
 * pin needing no route for it; the voyage takes the ship back up once the order is done. False while no
 * such order waits on the trader; a unit in the hands of a trader with a cart goes to the delivery rung
 * first, as on the route.
 */
export function planShipOrder(
  plan: PlannerContext,
  wait: (plan: PlannerContext, near: TraderHold) => boolean,
): boolean {
  const { world, ctx, entity: e } = plan;
  const ship = world.tryGet(e, TradeShip)?.vehicle;
  if (ship === undefined || (world.tryGet(ship, Vehicle)?.heldGoal ?? null) === null) return false;
  if (pinnedTraderAshore(world, ctx, ship) !== e) return false;
  const near = traderHoldOf(world, ctx, e);
  if (near.cart !== null && world.has(e, Carrying)) return false;
  const hold = ferryHoldOf(world, ctx, near, ship);
  if (hold === null) return wait(plan, near);
  return goAboard(plan, hold, false, { wait: (held) => wait(plan, held) });
}
