import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  Position,
  TRADE_ROUTE_HOUSES,
  type TradeAgreement,
  TradeRoute,
  type TradeRouteView,
  type TradeStop,
  VehicleDrive,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import type { ContentContext, SystemContext } from '../context.js';
import { buildingDoorNodes, interactionNode, vehicleAnchor } from '../footprint/index.js';
import { countsAsOwnStock, roomFor, stockOf, typeStoresGood } from '../missions/stock.js';
import { atomicDuration } from '../readviews/animations.js';
import { edibleGoodFormOf, isFood } from '../readviews/food.js';
import { isTraderJob } from '../readviews/jobs.js';
import { atOrWalk, collectAtomicOf, PILEUP_ATOMIC_ID, startAtomic } from '../settlers/atomics/start.js';
import type { PlannerContext } from '../settlers/planner/context.js';
import { interactionCell } from '../settlers/targets/index.js';
import { mayFetchGoodFrom } from '../stores/index.js';
import { releaseRider } from '../vehicles/crew.js';
import { moveVehicle, nodeOf, snapVehicleTarget } from '../vehicles/movement.js';
import { activeAgreement } from './agreements.js';
import { type CartHold, cartHoldOf, type TradeCart, tradeCartOf } from './cart.js';
import { sameFoodClass } from './goods.js';

/** How close to the stop's door the cart must stand before the trader works the stop, in map-point
 *  steps (`l_Trader_MoveVehicleNearHouse`: `VE_HexagonDirection_GetDistance` over 5 moves the cart). */
export const TRADE_CART_HOUSE_DISTANCE = 5;

/** How far around the door the cart's move point is looked for, in hexagon rings
 *  (`Tool_Vehicle_GetNextMovePointNearPosition` with radius 0x14). */
export const TRADE_CART_SEARCH_RADIUS = 20;

/** What the trader does next at its current stop. */
type TradeAction =
  | { readonly kind: 'load'; readonly good: number }
  | { readonly kind: 'unload'; readonly good: number; readonly into: Entity | null }
  | { readonly kind: 'next' }
  | { readonly kind: 'wait' };

const NEXT: TradeAction = { kind: 'next' };
const WAIT: TradeAction = { kind: 'wait' };

/**
 * TRADER - a trader commanding a cart with a valid route works it: it moves the cart to within
 * {@link TRADE_CART_HOUSE_DISTANCE} of each stop, then at the stop unloads what the stop takes and loads
 * what the other stop wants, and moves the cart over. Between the player's own houses the import marks
 * decide what moves; at a foreign house the chosen agreement does, give first, then take. A trader with
 * fewer than two standing houses, or a foreign stop with no valid agreement, is left to the rider rung;
 * one with no cart to command idles on foot (the HUD's `noVehicleForWork` note reads that state). While
 * the cart is under way or holds a goal for its crew the rider rung boards the trader, and the cart's
 * arrival sets it down again (`traderDisembarkSystem`). Reading of `l_StartTask_ExecuteJob_Trader`.
 * Approximation: the original's trader carries every unit between the house and the cart's door on its
 * back; here the load and unload clips at the house move the unit straight into and out of the hold.
 */
export function planTrader(plan: PlannerContext): boolean {
  const { world, ctx, entity: e } = plan;
  if (!isTraderJob(ctx.content, plan.jobType)) return false;
  const route = world.tryGet(e, TradeRoute);
  if (route === undefined) return false;
  if (!dropFallenStops(world, e, route)) return false;
  const cart = tradeCartOf(world, ctx, e);
  if (cart === null || cartUnderWay(world, cart)) return false;
  const live = world.get(e, TradeRoute);
  if (live.current < 0) world.mut(e, TradeRoute).current = 0;
  const current = world.get(e, TradeRoute);
  const stop = current.stops[current.current];
  const other = current.stops[1 - current.current];
  if (stop === undefined || other === undefined) return false;

  const hold = cartHoldOf(world, ctx, cart);
  const action = decide(world, ctx, e, current, hold, stop, other);
  switch (action.kind) {
    case 'wait':
      return false;
    case 'next': {
      world.mut(e, TradeRoute).current = 1 - current.current;
      return cartNearHouse(world, ctx, cart, other.house) || driveCartTo(plan, cart, other.house);
    }
    case 'load':
      if (!cartNearHouse(world, ctx, cart, stop.house)) return driveCartTo(plan, cart, stop.house);
      walkTo(plan, stop.house, () => {
        const atomicId = collectAtomicOf(world, ctx, stop.house);
        startAtomic(
          world,
          e,
          atomicId,
          { kind: 'cartLoad', from: stop.house, goodType: action.good },
          atomicDuration(ctx.content, plan, atomicId),
          stop.house,
        );
      });
      return true;
    case 'unload':
      if (!cartNearHouse(world, ctx, cart, stop.house)) return driveCartTo(plan, cart, stop.house);
      walkTo(plan, stop.house, () => {
        startAtomic(
          world,
          e,
          PILEUP_ATOMIC_ID,
          { kind: 'cartUnload', store: action.into, goodType: action.good },
          atomicDuration(ctx.content, plan, PILEUP_ATOMIC_ID),
          action.into,
        );
      });
      return true;
  }
}

/** Whether the cart drives or holds a goal until its crew is in: the trader rides along, not works. */
function cartUnderWay(world: World, cart: TradeCart): boolean {
  return world.has(cart.vehicle, VehicleDrive) || cart.state.heldGoal !== null;
}

function houseDoor(world: World, ctx: SystemContext, house: Entity): HalfCellNode | null {
  const door = interactionNode(world, ctx, house);
  return door === null ? null : { hx: door.x, hy: door.y };
}

/** Whether the cart stands within {@link TRADE_CART_HOUSE_DISTANCE} steps of the house's door. */
function cartNearHouse(world: World, ctx: SystemContext, cart: TradeCart, house: Entity): boolean {
  const anchor = vehicleAnchor(world, cart.vehicle);
  const door = houseDoor(world, ctx, house);
  return anchor !== null && door !== null && hexDistance(anchor, door) <= TRADE_CART_HOUSE_DISTANCE;
}

/**
 * `l_Trader_MoveVehicleNearHouse`: order the cart to the first node in ring order around the house's
 * door, out to {@link TRADE_CART_SEARCH_RADIUS}, that the cart may stand on and that is no house's door,
 * as a goto the cart holds until the trader boards. When no such node lies within the working distance
 * of the door, or the cart cannot drive there, the trader lets go of the cart and stays on foot. True
 * when the order stands. Approximation: the original detaches through the detach command with its own
 * note; here the trader's idle-without-a-cart state is what the player sees.
 */
function driveCartTo(plan: PlannerContext, cart: TradeCart, house: Entity): boolean {
  const { world, ctx, terrain, entity: e } = plan;
  const door = houseDoor(world, ctx, house);
  if (door === null) return false;
  const doors = buildingDoorNodes(world, ctx, terrain);
  const goal = snapVehicleTarget(world, ctx, terrain, cart.vehicle, door, {
    radius: TRADE_CART_SEARCH_RADIUS,
    exclude: (node) => doors.has(node),
  });
  const point = goal === null ? null : nodeOf(terrain, goal);
  if (
    point === null ||
    hexDistance(point, door) > TRADE_CART_HOUSE_DISTANCE ||
    !moveVehicle(world, ctx, { kind: 'moveVehicle', vehicle: cart.vehicle, x: point.hx, y: point.hy })
  ) {
    releaseRider(world, e, cart.vehicle);
    return false;
  }
  return true;
}

function walkTo(plan: PlannerContext, house: Entity, start: () => void): void {
  const { world, ctx, terrain, entity: e, here } = plan;
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, house, here), start);
}

/** Drop every stop whose house fell; reports whether a full route is left to work. */
function dropFallenStops(world: World, e: Entity, route: TradeRouteView): boolean {
  const standing = route.stops.filter((stop) => isStandingHouse(world, stop.house));
  if (standing.length !== route.stops.length) {
    const live = world.mut(e, TradeRoute);
    live.stops = live.stops.filter((stop) => isStandingHouse(world, stop.house));
    live.current = -1;
    live.given = 0;
    live.received = 0;
    if (!live.stops.some((stop) => stop.foreign)) live.agreement = -1;
  }
  return standing.length === TRADE_ROUTE_HOUSES;
}

function isStandingHouse(world: World, house: Entity): boolean {
  if (!world.isAlive(house) || !world.has(house, Position)) return false;
  const building = world.tryGet(house, Building);
  return building !== undefined && building.built === ONE;
}

function decide(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  route: TradeRouteView,
  hold: CartHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): TradeAction {
  if (!stop.foreign && !other.foreign) return decideDomestic(world, ctx, hold, stop, other);
  const agreement = activeAgreement(world, trader, route);
  if (agreement === undefined) return WAIT;
  return stop.foreign
    ? decideExchange(world, ctx, trader, route, hold, stop.house, agreement)
    : decidePreparation(world, ctx, hold, stop.house, agreement);
}

/**
 * At the player's own house before a foreign trip: clear the cart of everything but the give good into
 * the house, then load give goods while the cart has room for the whole exchange and the house has
 * spare; leave once a batch is aboard. Original behavior (reading): the room test keeps
 * space for the take goods every aboard batch will bring back.
 */
function decidePreparation(
  world: World,
  ctx: SystemContext,
  hold: CartHold,
  house: Entity,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const stray = hold.entries.find(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
  if (stray !== undefined) return unloadInto(world, ctx, house, stray[0]);
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const give = Math.max(1, agreement.giveAmount);
  const extra = Math.max(0, agreement.takeAmount - agreement.giveAmount);
  const toCompleteBatch = give - (aboard % give);
  const roomNeeded = (Math.floor(aboard / give) + 1) * extra + toCompleteBatch;
  const stocked = stockedFormAt(world, ctx, house, agreement.giveGood);
  const foodFromHome =
    isFood(ctx, agreement.giveGood) && isHome(ctx, world.get(house, Building).buildingType);
  if (
    stocked !== undefined &&
    hold.carries(stocked) &&
    roomNeeded <= hold.room &&
    !foodFromHome &&
    spareOf(world, ctx, house, stocked) >= 1
  ) {
    return { kind: 'load', good: stocked };
  }
  return aboard >= agreement.giveAmount ? NEXT : WAIT;
}

/**
 * At the foreign house: hand the give goods over one by one, then take the agreed goods aboard, then
 * start over while another batch is aboard; go home when the cart runs out or fills up, or when the
 * house runs out of the take good mid-batch (what was handed over stays given, as the original's goods
 * vanish into the house). Approximation: nothing is handed over while the house holds fewer take goods
 * than one batch pays out, where the original delivers regardless; a trader with only give goods aboard
 * then waits at the house, one with anything else aboard carries it home first.
 */
function decideExchange(
  world: World,
  ctx: SystemContext,
  trader: Entity,
  route: TradeRouteView,
  hold: CartHold,
  house: Entity,
  agreement: DeepReadonly<TradeAgreement>,
): TradeAction {
  const aboard = aboardOfClass(ctx, hold, agreement.giveGood);
  const stocked = stockedFormAt(world, ctx, house, agreement.takeGood);
  const onOffer = stocked === undefined ? 0 : stockOf(world, house, stocked);
  if (route.given < agreement.giveAmount) {
    if (aboard + route.given < agreement.giveAmount) return NEXT;
    if (route.given === 0 && onOffer < agreement.takeAmount) {
      const otherAboard = hold.entries.some(([good]) => !sameFoodClass(ctx, good, agreement.giveGood));
      return otherAboard ? NEXT : WAIT;
    }
    // The cart holds a dish as its edible, so the unit handed over is whichever aboard good the
    // agreement's give good matches.
    const giving = hold.entries.find(([good]) => sameFoodClass(ctx, good, agreement.giveGood));
    const slot = giving === undefined ? undefined : storableFormAt(world, ctx, house, giving[0]);
    if (giving === undefined || slot === undefined || roomFor(world, ctx, house, slot) <= 0) return NEXT;
    return { kind: 'unload', good: giving[0], into: house };
  }
  if (route.received < agreement.takeAmount) {
    if (hold.room <= 0) return NEXT;
    if (stocked === undefined || !hold.carries(stocked) || onOffer <= 0) {
      resetExchange(world, trader);
      return NEXT;
    }
    return { kind: 'load', good: stocked };
  }
  resetExchange(world, trader);
  return aboard >= agreement.giveAmount
    ? decideExchange(world, ctx, trader, world.get(trader, TradeRoute), hold, house, agreement)
    : NEXT;
}

/** The units aboard that answer for `good`: the good itself, or a dish's edible form of its class. */
function aboardOfClass(ctx: ContentContext, hold: CartHold, good: number): number {
  let total = 0;
  for (const [aboard, amount] of hold.entries) if (sameFoodClass(ctx, aboard, good)) total += amount;
  return total;
}

function resetExchange(world: World, trader: Entity): void {
  const live = world.mut(trader, TradeRoute);
  live.given = 0;
  live.received = 0;
}

/**
 * Between the player's own houses: unload what this stop takes, else load the good the other stop is
 * shortest of relative to this one. A good moves only where an import mark admits it, or anywhere while
 * no mark is set on either stop, and food is never taken out of a home (reading). Approximations: the
 * original ranks candidates by the houses' request counters too, which this build does not keep, so
 * ties go to the lowest good id; and it keeps "home enhancer" goods out of a home, a good class the
 * content does not flag.
 */
function decideDomestic(
  world: World,
  ctx: SystemContext,
  hold: CartHold,
  stop: DeepReadonly<TradeStop>,
  other: DeepReadonly<TradeStop>,
): TradeAction {
  const unmarked = stop.imports.length === 0 && other.imports.length === 0;
  const admits = (at: DeepReadonly<TradeStop>, good: number): boolean =>
    unmarked || at.imports.includes(good) || at.imports.includes(edibleGoodFormOf(ctx.content, good));
  const hereType = world.get(stop.house, Building).buildingType;

  // Aboard goods go to the stop that is shorter of them (reading of the original's unload score,
  // `(aboard + other - here) / 2`), so what was just loaded for the other stop stays aboard.
  for (const [good, aboard] of hold.entries) {
    if (!admits(stop, good)) continue;
    const slot = storableFormAt(world, ctx, stop.house, good);
    if (slot === undefined || roomFor(world, ctx, stop.house, slot) <= 0) continue;
    const there = storableFormAt(world, ctx, other.house, good);
    const shortfall =
      (there === undefined ? 0 : stockOf(world, other.house, there)) - stockOf(world, stop.house, slot);
    if (Math.floor((aboard + shortfall) / 2) > 0 || there === undefined) {
      return { kind: 'unload', good, into: stop.house };
    }
  }

  if (hold.room > 0) {
    let best: { good: number; score: number } | undefined;
    for (const good of ownGoodsOf(ctx, hereType)) {
      if (!admits(other, good) || (isFood(ctx, good) && isHome(ctx, hereType))) continue;
      const spare = spareOf(world, ctx, stop.house, good);
      if (spare <= 0) continue;
      const carried = edibleGoodFormOf(ctx.content, good);
      if (!hold.carries(carried)) continue;
      const slot = storableFormAt(world, ctx, other.house, carried);
      if (slot === undefined || roomFor(world, ctx, other.house, slot) <= 0) continue;
      const score = Math.floor(
        (stockOf(world, stop.house, good) - stockOf(world, other.house, slot) - hold.amount(carried)) / 2,
      );
      if (score > 0 && (best === undefined || score > best.score)) best = { good, score };
    }
    if (best !== undefined) return { kind: 'load', good: best.good };
  }
  return NEXT;
}

function unloadInto(world: World, ctx: SystemContext, house: Entity, good: number): TradeAction {
  const slot = storableFormAt(world, ctx, house, good);
  const into = slot !== undefined && roomFor(world, ctx, house, slot) > 0 ? house : null;
  return { kind: 'unload', good, into };
}

function isHome(ctx: ContentContext, buildingType: number): boolean {
  return contentIndex(ctx.content).buildings.get(buildingType)?.kind === BUILDING_KIND.home;
}

/** The goods a house type counts as its own stock, ascending: what a trader may take out of it. */
function ownGoodsOf(ctx: ContentContext, buildingType: number): number[] {
  const stored = contentIndex(ctx.content).storedGoodsByBuilding.get(buildingType);
  if (stored === undefined) return [];
  return [...stored].filter((good) => countsAsOwnStock(ctx, buildingType, good)).sort((a, b) => a - b);
}

/** The units of `good` a house can give up: its own stock, none of it while its recipe consumes the
 *  good (the reserve it runs on). Approximation of the original's per-house minimum stock setting. */
function spareOf(world: World, ctx: SystemContext, house: Entity, good: number): number {
  const stocked = stockedFormAt(world, ctx, house, good);
  if (stocked === undefined || !mayFetchGoodFrom(world, ctx, house, stocked)) return 0;
  return stockOf(world, house, stocked);
}

/** The good a house answers a request for `good` with out of its own stock: the good itself, else the
 *  first dish of its edible class the house makes (a bakery gives bread for `food_simple`). */
function stockedFormAt(world: World, ctx: ContentContext, house: Entity, good: number): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (countsAsOwnStock(ctx, type, good)) return good;
  const index = contentIndex(ctx.content);
  const stored = index.storedGoodsByBuilding.get(type);
  if (stored === undefined) return undefined;
  for (const candidate of [...stored].sort((a, b) => a - b)) {
    if (countsAsOwnStock(ctx, type, candidate) && sameFoodClass(ctx, candidate, good)) return candidate;
  }
  return undefined;
}

/** The slot a house takes `good` into, on any of its shelves, inputs included; undefined with none. */
function storableFormAt(world: World, ctx: ContentContext, house: Entity, good: number): number | undefined {
  const type = world.get(house, Building).buildingType;
  if (typeStoresGood(ctx, type, good)) return good;
  const edible = edibleGoodFormOf(ctx.content, good);
  return edible !== good && typeStoresGood(ctx, type, edible) ? edible : undefined;
}
