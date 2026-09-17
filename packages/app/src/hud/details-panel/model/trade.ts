import { entityById, type TradeOffer, type TraderView, type WorldSnapshot } from '@open-northland/sim';
import { num } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { liveAmounts } from './building-materials.js';
import { buildingTitle, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

/** One import toggle of a route stop: a good the house may take in, marked or not. */
export interface TradeImportModel {
  readonly goodType: number;
  readonly label: string;
  readonly goodId?: string;
  readonly selected: boolean;
}

export interface TradeStopModel {
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
  readonly offers: readonly TradeOfferModel[];
  readonly status: readonly string[];
  /** Whether the route has a free stop to attach a house to. */
  readonly canAttach: boolean;
}

/** "give N X for M Y", the wording the offer rows and the exchange status share. */
export function tradeOfferLabel(ctx: UnitPanelModelContext, offer: TradeOffer): string {
  return formatMessage(messages().hud.tradeOffer, {
    giveAmount: offer.giveAmount,
    give: goodLabel(ctx, offer.giveGood),
    takeAmount: offer.takeAmount,
    take: goodLabel(ctx, offer.takeGood),
  });
}

/**
 * The goods a stop offers import marks for: what its house stores that the other stop currently holds,
 * plus every good already marked, so a mark can always be cleared. Authored: the original lists the
 * house's whole stock table, which for a warehouse is every good in the game.
 */
function importChoices(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  house: number,
  other: number | undefined,
  marked: readonly number[],
): TradeImportModel[] {
  const stored = storedGoodsOf(ctx, snapshot, house);
  const held = other === undefined ? new Set<number>() : new Set(heldGoodsOf(snapshot, other));
  const choices: TradeImportModel[] = [];
  for (const goodType of stored) {
    const selected = marked.includes(goodType);
    if (!selected && !held.has(goodType)) continue;
    const def = goodDef(ctx, goodType);
    choices.push({
      goodType,
      label: goodLabel(ctx, goodType),
      ...(def?.id !== undefined ? { goodId: def.id } : {}),
      selected,
    });
  }
  return choices;
}

function storedGoodsOf(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, house: number): number[] {
  const ent = entityById(snapshot, house);
  const typeId = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const def = ctx.buildings.find((b) => b.typeId === typeId);
  return (def?.stock ?? []).map((slot) => slot.goodType).sort((a, b) => a - b);
}

function heldGoodsOf(snapshot: WorldSnapshot, house: number): number[] {
  const held: number[] = [];
  for (const [good, amount] of liveAmounts(entityById(snapshot, house)?.components.Stockpile)) {
    if (amount > 0) held.push(good);
  }
  return held;
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
  const stops: TradeStopModel[] = view.stops.map((stop, i) => ({
    house: stop.house,
    label: houseLabel(ctx, snapshot, stop.house, stop.foreign),
    foreign: stop.foreign,
    imports: stop.foreign
      ? []
      : importChoices(ctx, snapshot, stop.house, view.stops[1 - i]?.house, stop.imports),
  }));
  const foreign = view.stops.find((stop) => stop.foreign);
  const offers: TradeOfferModel[] = (foreign?.offers ?? []).map((offer) => ({
    index: offer.index,
    label: tradeOfferLabel(ctx, offer),
    selected: offer.index === view.agreement,
  }));
  const status: string[] = [cartLine(ctx, view)];
  if (view.stops.length < 2) status.push(hud.tradeNoRoute);
  else if (foreign !== undefined) {
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
  return { stops, offers, status, canAttach: view.stops.length < 2 };
}
