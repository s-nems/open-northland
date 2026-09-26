import { entityById, type TradeOffer, type TraderView, type WorldSnapshot } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { buildingTitle, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

/** One import toggle of a route stop: a good the house may take in, marked or not. */
export interface TradeImportModel {
  readonly goodType: number;
  readonly label: string;
  readonly goodId?: string;
  readonly selected: boolean;
}

export interface TradeStopModel {
  readonly slot: number;
  readonly house: number;
  readonly label: string;
  readonly foreign: boolean;
  readonly imports: readonly TradeImportModel[];
}

export interface TradeOfferModel {
  readonly index: number;
  readonly label: string;
  readonly selected: boolean;
}

/** The Handel section of a trader: its route's stops with their import marks, the agreements the
 *  foreign stop offers, the cart it commands with its load, and the running exchange. */
export interface TradePanelModel {
  readonly stops: readonly TradeStopModel[];
  /** The goods both own stops store, each lit while both stops mark it: the trader then evens the two
   *  stocks out instead of carrying the good one way. Empty on a route that is not two own houses. */
  readonly balance: readonly TradeImportModel[];
  readonly offers: readonly TradeOfferModel[];
  readonly status: readonly string[];
  /** Whether the route has a free stop to attach a house to. */
  readonly canAttach: boolean;
  /** Whether that free stop is the first slot, so its attach row goes above the stops. */
  readonly attachFirst: boolean;
}

/** "you give N X, you get M Y", the wording of an agreement wherever it is listed. */
export function tradeOfferLabel(ctx: UnitPanelModelContext, offer: TradeOffer): string {
  return formatMessage(messages().hud.tradeOffer, {
    giveAmount: offer.giveAmount,
    give: goodLabel(ctx, offer.giveGood),
    takeAmount: offer.takeAmount,
    take: goodLabel(ctx, offer.takeGood),
  });
}

/**
 * The goods a stop offers import marks for: everything its house stores, so the trader can be told to
 * bring a good the other stop does not hold yet. Authored: the original lists the house's whole stock
 * table, which for a warehouse is every good in the game.
 */
function importChoices(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  house: number,
  marked: (goodType: number) => boolean,
): TradeImportModel[] {
  return storedGoodsOf(ctx, snapshot, house).map((goodType) => {
    const def = goodDef(ctx, goodType);
    return {
      goodType,
      label: goodLabel(ctx, goodType),
      ...(def?.id !== undefined ? { goodId: def.id } : {}),
      selected: marked(goodType),
    };
  });
}

function storedGoodsOf(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, house: number): number[] {
  const ent = entityById(snapshot, house);
  const typeId = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const def = ctx.buildings.find((b) => b.typeId === typeId);
  return (def?.stock ?? []).map((slot) => slot.goodType).sort((a, b) => a - b);
}

function houseLabel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  house: number,
  foreign: boolean,
): string {
  const ent = entityById(snapshot, house);
  const typeId = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const title = buildingTitle(ctx, typeId);
  const owner = num((ent?.components.Owner as { player?: unknown } | undefined)?.player);
  return foreign
    ? formatMessage(messages().hud.tradeForeignHouse, { house: title, player: owner ?? '-' })
    : title;
}

/** "Handcart: 3 wood" for the cart the trader commands, or the line saying it has none. */
function cartLine(ctx: UnitPanelModelContext, view: TraderView): string {
  const hud = messages().hud;
  if (view.cart === null) return hud.tradeNoCart;
  const cargo =
    view.cargo.length === 0
      ? hud.tradeCartEmpty
      : view.cargo.map((line) => `${line.amount} ${goodLabel(ctx, line.good)}`).join(', ');
  const vehicle = ctx.vehicleLabel?.(view.cart.vehicleType) ?? hud.tradeCart;
  return formatMessage(hud.tradeCartLoad, { vehicle, cargo });
}

/** The Handel model of one settler, or null for anything that is no trader. */
export function tradePanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entityId: number,
): TradePanelModel | null {
  const view = ctx.traderView?.(entityId);
  if (view === undefined) return null;
  const hud = messages().hud;
  const foreign = view.stops.find((stop) => stop.foreign);
  // With another tribe the agreement alone decides what moves, so no stop offers import marks.
  const stops: TradeStopModel[] = view.stops.map((stop) => ({
    slot: stop.slot,
    house: stop.house,
    label: houseLabel(ctx, snapshot, stop.house, stop.foreign),
    foreign: stop.foreign,
    imports:
      foreign !== undefined
        ? []
        : importChoices(ctx, snapshot, stop.house, (good) => stop.imports.includes(good)),
  }));
  const [first, second] = view.stops;
  const balance =
    foreign !== undefined || first === undefined || second === undefined
      ? []
      : importChoices(
          ctx,
          snapshot,
          first.house,
          (good) => first.imports.includes(good) && second.imports.includes(good),
        ).filter((choice) => storedGoodsOf(ctx, snapshot, second.house).includes(choice.goodType));
  const offers: TradeOfferModel[] = (foreign?.offers ?? []).map((offer) => ({
    index: offer.index,
    label: tradeOfferLabel(ctx, offer),
    selected: offer.index === view.agreement,
  }));
  const status: string[] = [cartLine(ctx, view)];
  if (view.stops.length < 2) status.push(hud.tradeNoRoute);
  else if (foreign === undefined) {
    if (view.stops.every((stop) => stop.imports.length === 0)) status.push(hud.tradeNoImports);
  } else {
    const chosen = foreign.offers.find((offer) => offer.index === view.agreement);
    if (chosen === undefined) status.push(hud.tradeNoAgreement);
    else if (!view.agreementHolds) status.push(hud.tradeNotFriends);
    else {
      status.push(
        formatMessage(hud.tradeExchange, {
          given: view.given,
          giveAmount: chosen.giveAmount,
          received: view.received,
          takeAmount: chosen.takeAmount,
        }),
      );
    }
  }
  const canAttach = view.stops.length < 2;
  return { stops, balance, offers, status, canAttach, attachFirst: canAttach && first?.slot !== 0 };
}
