import {
  Building,
  isForeignHouse,
  MissionObjectId,
  ownerOf,
  Position,
  Rider,
  Settler,
  TRADE_LIMIT_NONE,
  type TradeImportMark,
  TradeRoute,
  type TradeRouteView,
  TradeShip,
  tradeRouteOf,
  Vehicle,
  VehicleStock,
  vehicleStockEntries,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { MapContext } from '../context.js';
import { isTraderJob } from '../readviews/jobs.js';
import { activeAgreement, agreementsAt, type HouseAgreement } from './agreements.js';
import { traderHoldOf } from './hold.js';
import { flaggedForSettlement, isSettlementAnchor, settlementsOverlap } from './settlement.js';
import { mooringTargetOfStop, routeCrossesSea, shipLiesOn } from './ship.js';

/**
 * The ship question of a trader's route as the panel explains it: `notNeeded` for a route on one
 * continent or short of two stops, `needed` for a crossing with no pinned ship, `ready` with the ship at
 * the trader's shore or the trader aboard it, `unreachable` with the ship out of its reach or no shore
 * for it at a stop.
 */
export type TraderShipState = 'notNeeded' | 'needed' | 'ready' | 'unreachable';

/** One agreement as a window lists it. */
export interface TradeOffer {
  readonly index: number;
  readonly giveGood: number;
  readonly giveAmount: number;
  readonly takeGood: number;
  readonly takeAmount: number;
}

export interface TradeStopView {
  readonly slot: number;
  readonly house: Entity;
  readonly foreign: boolean;
  /** The import marks with their limits, ascending by good. */
  readonly imports: readonly TradeImportMark[];
  /** The agreements the house offers; only a foreign stop lists any. */
  readonly offers: readonly TradeOffer[];
  /** The stop carries the flag to stand for its whole settlement. */
  readonly settlement: boolean;
  /** The stop is an own storehouse, so it may stand for its settlement. */
  readonly settles: boolean;
  /** The other stop is flagged and the two settlements share a house: this stop's flag cannot be turned
   *  on, a set flag on the second stop is held aside, and a set flag on the first stop still stands. */
  readonly sharesSettlement: boolean;
  /** The flag is set but held aside: the stop counts its storehouse alone. */
  readonly settlementSuspended: boolean;
}

/**
 * A trader's route as the selected-unit window shows it. `agreementHolds` is false while the chosen
 * agreement is off the foreign house's list or the partner is no friend, the state the trader waits in.
 */
export interface TraderView {
  readonly stops: readonly TradeStopView[];
  readonly current: number;
  readonly agreement: number;
  readonly agreementHolds: boolean;
  readonly given: number;
  readonly received: number;
  /** The agreement's limits in units; `TRADE_LIMIT_NONE` sets none. */
  readonly giveKeep: number;
  readonly takeUpTo: number;
  /** The hauling cart the trader pulls as its tool, or null while it goes on foot. */
  readonly cart: { readonly entity: Entity; readonly vehicleType: number } | null;
  /** The goods in its hold, the cart's or its hands, ascending by good. */
  readonly cargo: readonly { readonly good: number; readonly amount: number }[];
  /** The ship pinned to its route, or null. */
  readonly ship: { readonly entity: Entity; readonly vehicleType: number } | null;
  /** The goods in the pinned ship's hold, ascending by good; empty without a ship. */
  readonly shipCargo: readonly { readonly good: number; readonly amount: number }[];
  readonly shipState: TraderShipState;
}

function offerOf(offer: HouseAgreement): TradeOffer {
  return {
    index: offer.index,
    giveGood: offer.agreement.giveGood,
    giveAmount: offer.agreement.giveAmount,
    takeGood: offer.agreement.takeGood,
    takeAmount: offer.agreement.takeAmount,
  };
}

/** The agreements `house` offers a visiting trader, as detached copies; empty for any other house. */
export function tradeOffersAt(world: World, house: Entity): TradeOffer[] {
  return agreementsAt(world, house).map(offerOf);
}

/**
 * Every agreement `partner`'s houses offer, each listed once in table order however many houses carry
 * it; what a window tells a player about a tribe it could trade with.
 */
export function tradeOffersOf(world: World, partner: number): TradeOffer[] {
  const offered = new Map<number, TradeOffer>();
  for (const house of world.query(MissionObjectId, Building)) {
    if (ownerOf(world, house) !== partner) continue;
    for (const offer of agreementsAt(world, house)) offered.set(offer.index, offerOf(offer));
  }
  return [...offered.values()].sort((a, b) => a.index - b.index);
}

function shipStateOf(world: World, ctx: MapContext, trader: Entity): TraderShipState {
  const terrain = ctx.terrain;
  if (terrain === undefined || !routeCrossesSea(world, ctx, terrain, trader)) return 'notNeeded';
  const ship = world.tryGet(trader, TradeShip)?.vehicle;
  if (ship === undefined) return 'needed';
  const stops = world.get(trader, TradeRoute).stops;
  if (stops.some((stop) => mooringTargetOfStop(world, ctx, terrain, ship, stop) === null))
    return 'unreachable';
  if (world.tryGet(trader, Rider)?.vehicle === ship) return 'ready';
  const pos = world.tryGet(trader, Position);
  if (pos === undefined) return 'unreachable';
  const at = nodeOfPosition(pos.x, pos.y);
  const continent = terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy));
  return shipLiesOn(world, ctx, terrain, ship, continent) ? 'ready' : 'unreachable';
}

/** Whether the other stop of an own route is flagged for its settlement and the two settlements share a
 *  house; asked of an own storehouse stop alone. */
function sharesSettlement(
  world: World,
  ctx: MapContext,
  trader: Entity,
  stops: TradeRouteView['stops'],
  index: number,
): boolean {
  const stop = stops[index];
  const other = stops[1 - index];
  const terrain = ctx.terrain;
  if (stop === undefined || other === undefined || terrain === undefined) return false;
  if (!flaggedForSettlement(world, trader, other)) return false;
  if (isForeignHouse(world, trader, stop.house) || !isSettlementAnchor(world, ctx, stop.house)) return false;
  return settlementsOverlap(world, ctx, terrain, trader, stop.house, other.house);
}

/** The route of a trader, as a detached copy; undefined for anything that is no trader. */
export function traderView(world: World, ctx: MapContext, trader: Entity): TraderView | undefined {
  const settler = world.tryGet(trader, Settler);
  if (settler === undefined || !isTraderJob(ctx.content, settler.jobType)) return undefined;
  const hold = traderHoldOf(world, ctx, trader);
  const cartView =
    hold.cart === null ? null : { entity: hold.cart, vehicleType: world.get(hold.cart, Vehicle).vehicleType };
  const cargo = hold.entries.map(([good, amount]) => ({ good, amount }));
  const shipEntity = world.tryGet(trader, TradeShip)?.vehicle;
  const pinned = shipEntity === undefined ? undefined : world.tryGet(shipEntity, Vehicle);
  const ship =
    shipEntity === undefined || pinned === undefined
      ? null
      : { entity: shipEntity, vehicleType: pinned.vehicleType };
  const lines = shipEntity === undefined ? undefined : world.tryGet(shipEntity, VehicleStock);
  const shipCargo =
    lines === undefined
      ? []
      : vehicleStockEntries(lines).flatMap(([good, line]) =>
          line.current > 0 ? [{ good, amount: line.current }] : [],
        );
  const route = tradeRouteOf(world, trader);
  if (route === undefined) {
    return {
      stops: [],
      current: -1,
      agreement: -1,
      agreementHolds: false,
      given: 0,
      received: 0,
      giveKeep: TRADE_LIMIT_NONE,
      takeUpTo: TRADE_LIMIT_NONE,
      cart: cartView,
      cargo,
      ship,
      shipCargo,
      shipState: 'notNeeded',
    };
  }
  return {
    stops: route.stops.map((stop, index) => {
      const foreign = isForeignHouse(world, trader, stop.house);
      const shared = sharesSettlement(world, ctx, trader, route.stops, index);
      return {
        slot: stop.slot,
        house: stop.house,
        foreign,
        imports: stop.imports.map((mark) => ({ good: mark.good, upTo: mark.upTo, keep: mark.keep })),
        offers: foreign ? agreementsAt(world, stop.house).map(offerOf) : [],
        settlement: stop.settlement,
        settles: !foreign && isSettlementAnchor(world, ctx, stop.house),
        sharesSettlement: shared,
        settlementSuspended: stop.settlement && shared && index > 0,
      };
    }),
    current: route.current,
    agreement: route.agreement,
    agreementHolds: activeAgreement(world, trader, route) !== undefined,
    given: route.given,
    received: route.received,
    giveKeep: route.giveKeep,
    takeUpTo: route.takeUpTo,
    cart: cartView,
    cargo,
    ship,
    shipCargo,
    shipState: shipStateOf(world, ctx, trader),
  };
}
