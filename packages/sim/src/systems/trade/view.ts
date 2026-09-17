import { ownerOf, Settler, tradeRouteOf } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isTraderJob } from '../readviews/jobs.js';
import { activeAgreement, agreementsAt, type HouseAgreement } from './agreements.js';
import { cartHoldOf, tradeCartOf } from './cart.js';

/** One agreement as a window lists it. */
export interface TradeOffer {
  readonly index: number;
  readonly giveGood: number;
  readonly giveAmount: number;
  readonly takeGood: number;
  readonly takeAmount: number;
}

export interface TradeStopView {
  readonly house: Entity;
  readonly foreign: boolean;
  readonly imports: readonly number[];
  /** The agreements the house offers; only a foreign stop lists any. */
  readonly offers: readonly TradeOffer[];
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
  /** The cart the trader commands, or null while it is on foot. */
  readonly cart: { readonly entity: Entity; readonly vehicleType: number } | null;
  /** The goods aboard that cart, ascending by good; empty without one. */
  readonly cargo: readonly { readonly good: number; readonly amount: number }[];
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

/** The route of a trader, as a detached copy; undefined for anything that is no trader. */
export function traderView(world: World, ctx: ContentContext, trader: Entity): TraderView | undefined {
  const settler = world.tryGet(trader, Settler);
  if (settler === undefined || !isTraderJob(ctx.content, settler.jobType)) return undefined;
  const cart = tradeCartOf(world, ctx, trader);
  const cartView = cart === null ? null : { entity: cart.vehicle, vehicleType: cart.type.typeId };
  const cargo =
    cart === null ? [] : cartHoldOf(world, ctx, cart).entries.map(([good, amount]) => ({ good, amount }));
  const route = tradeRouteOf(world, trader);
  if (route === undefined) {
    return {
      stops: [],
      current: -1,
      agreement: -1,
      agreementHolds: false,
      given: 0,
      received: 0,
      cart: cartView,
      cargo,
    };
  }
  const player = ownerOf(world, trader);
  return {
    stops: route.stops.map((stop) => ({
      house: stop.house,
      foreign: stop.foreign,
      imports: [...stop.imports],
      offers: stop.foreign && player !== undefined ? agreementsAt(world, stop.house).map(offerOf) : [],
    })),
    current: route.current,
    agreement: route.agreement,
    agreementHolds: activeAgreement(world, trader, route) !== undefined,
    given: route.given,
    received: route.received,
    cart: cartView,
    cargo,
  };
}
