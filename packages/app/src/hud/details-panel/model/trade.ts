import {
  entityById,
  TRADE_LIMIT_NONE,
  TRADE_ROUTE_HOUSES,
  type TradeImportMark,
  type TradeOffer,
  type TraderShipState,
  type TraderView,
  type TradeStopView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { num } from '../../../game/snapshot/index.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { goodCategoryTab } from '../../good-categories.js';
import { stockRows } from './building-materials.js';
import {
  buildingDef,
  buildingTitle,
  goodDef,
  goodLabel,
  holdLoadLine,
  type UnitPanelModelContext,
  vehicleTitle,
} from './context.js';

export { TRADE_LIMIT_NONE, TRADE_ROUTE_HOUSES };

/** The slot of the route's first stop (A) and of its second (B). */
export const TRADE_SLOT_A = 0;
export const TRADE_SLOT_B = 1;

/** The finite top of an import mark's two limits in the panel's counters, in units. Authored: a
 *  warehouse shelf holds 45 of a good, so the top leaves room for a larger store. */
export const TRADE_LIMIT_MAX = 100;

/** Which way a transfer moves its good between two own stops: carried into A, into B, or balanced. */
export type TradeDirection = 'toA' | 'toB' | 'both';

export interface TradeStopModel {
  readonly slot: number;
  readonly house: number;
  readonly label: string;
  readonly foreign: boolean;
  /** The stop the trader serves now. */
  readonly heading: boolean;
  /** The stop carries the flag to stand for its whole settlement. */
  readonly settlement: boolean;
  /** The stop is an own storehouse, so it may stand for its settlement. */
  readonly settles: boolean;
  /** The other stop carries the flag and the two settlements share a house. */
  readonly sharesSettlement: boolean;
  /** The flag is set but held aside while the two settlements share a house. */
  readonly settlementSuspended: boolean;
}

/** One good an own stop's house stores: its stock table's line with the units it holds now. */
export interface TradeStockRow {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  /** The stock category tab (0-7) the good belongs to. */
  readonly category: number;
  readonly amount: number;
  /** The house's shelf for the good, in units. */
  readonly capacity: number;
  /** The edible a dish travels as (bread as food_simple); absent for a good carried as itself. */
  readonly carriedAs?: number;
}

/** What each stop of a two-stop own route stores, in its stock table's order. */
export interface TradeRouteStock {
  readonly a: readonly TradeStockRow[];
  readonly b: readonly TradeStockRow[];
}

/** One good the route moves: the good marked at one stop (carried into it) or at both (balanced). */
export interface TradeTransferModel {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly category: number;
  readonly direction: TradeDirection;
  /** The one-way destination mark's fill ceiling and source reserve; {@link TRADE_LIMIT_NONE} for a
   *  balanced good. */
  readonly upTo: number;
  readonly keep: number;
  /** As {@link TradeStockRow.carriedAs}. */
  readonly carriedAs?: number;
}

/** One side of an agreement: so many units of a good. */
export interface TradeOfferSide {
  readonly amount: number;
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
}

export interface TradeOfferModel {
  readonly index: number;
  readonly label: string;
  readonly give: TradeOfferSide;
  readonly take: TradeOfferSide;
  readonly selected: boolean;
  /** The chosen agreement's running exchange: units handed over and taken since the last batch. */
  readonly progress: { readonly given: number; readonly received: number } | null;
}

/** The ship pinned to the route: the link, with its hold in the tooltip. */
export interface TradeShipLink {
  readonly entity: number;
  readonly label: string;
  /** "Small ship: 3 wood, 2 iron", or "Small ship: empty". */
  readonly load: string;
}

/** The Ship row under the stops: the pinned ship or the pick that pins one, and why the route cannot
 *  sail as it stands, in a short word and a tooltip. */
export interface TradeShipModel {
  readonly ship: TradeShipLink | null;
  readonly note: { readonly label: string; readonly tooltip: string } | null;
}

/** The trader a Trade section and the trade window act for: the selected person, or the one riding
 *  the selected cart. */
export interface TraderSubject {
  readonly entityId: number;
  readonly name: string;
  readonly trade: TradePanelModel | null;
}

/**
 * The Trade model of a trader, for the settler panel's summary, the trade window and the vehicle
 * window: the route's stops by slot, what two own stops store and move, or the agreements a foreign
 * stop offers.
 */
export interface TradePanelModel {
  /** The occupied stops in slot order. */
  readonly stops: readonly TradeStopModel[];
  /** The slot the next house goes to, while the route has one free. */
  readonly attachSlot: number | null;
  /** A stop belongs to another tribe: the agreement alone decides what moves. */
  readonly foreign: boolean;
  /** Both houses' stock tables while the route is two own stops, else null. Always built: the vehicle
   *  window reads it too, and it costs two stock tables of the trader's own route. */
  readonly stock: TradeRouteStock | null;
  /** The marked goods in good order; empty unless the route is two own stops. */
  readonly transfers: readonly TradeTransferModel[];
  readonly offers: readonly TradeOfferModel[];
  /** Whether the chosen agreement trades now; false while none is chosen or the partner is no friend. */
  readonly agreementHolds: boolean;
  /** The chosen agreement's limits in units, {@link TRADE_LIMIT_NONE} for none: the give good kept back
   *  at home and the take good home is filled up to. */
  readonly giveKeep: number;
  readonly takeUpTo: number;
  readonly ship: TradeShipModel;
}

/** One side of an agreement: so many units of a good. */
export function offerSide(
  ctx: Pick<UnitPanelModelContext, 'goods'>,
  amount: number,
  goodType: number,
): TradeOfferSide {
  const def = goodDef(ctx, goodType);
  return {
    amount,
    goodType,
    label: goodLabel(ctx, goodType),
    ...(def?.id !== undefined ? { goodId: def.id } : {}),
  };
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

/** The goods a house keeps (its type's stock table) with the units it holds now. An upgrading house
 *  keeps them stashed on its `Upgrading` marker while its shelves hold the site's build goods. */
function houseStock(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, house: number): TradeStockRow[] {
  const ent = entityById(snapshot, house);
  const typeId = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const upgrading = ent?.components.Upgrading as { savedStock?: unknown } | undefined;
  const stock = upgrading === undefined ? ent?.components.Stockpile : { amounts: upgrading.savedStock };
  return stockRows(ctx, buildingDef(ctx, typeId), stock).map((row) => ({
    goodType: row.goodType,
    ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
    label: row.label,
    category: row.category,
    amount: row.amount,
    capacity: row.capacity ?? 0,
    ...carriedAsOf(ctx, row.goodType),
  }));
}

function carriedAsOf(ctx: UnitPanelModelContext, goodType: number): { readonly carriedAs?: number } {
  const carried = ctx.edibleGoodForm?.(goodType) ?? goodType;
  return carried === goodType ? {} : { carriedAs: carried };
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

function directionOf(atA: boolean, atB: boolean): TradeDirection | null {
  if (atA && atB) return 'both';
  if (atA) return 'toA';
  return atB ? 'toB' : null;
}

/** One transfer per good marked at either stop, ascending by good. */
function transfersOf(ctx: UnitPanelModelContext, a: TradeStopView, b: TradeStopView): TradeTransferModel[] {
  const marksA = new Map(a.imports.map((mark) => [mark.good, mark]));
  const marksB = new Map(b.imports.map((mark) => [mark.good, mark]));
  const goods = [...new Set([...marksA.keys(), ...marksB.keys()])].sort((x, y) => x - y);
  return goods.flatMap((goodType) => {
    const markA = marksA.get(goodType);
    const markB = marksB.get(goodType);
    const direction = directionOf(markA !== undefined, markB !== undefined);
    if (direction === null) return [];
    const limits: TradeImportMark | undefined =
      direction === 'toA' ? markA : direction === 'toB' ? markB : undefined;
    const goodId = goodDef(ctx, goodType)?.id;
    return [
      {
        goodType,
        ...(goodId !== undefined ? { goodId } : {}),
        label: goodLabel(ctx, goodType),
        category: goodCategoryTab(goodId),
        direction,
        upTo: limits?.upTo ?? TRADE_LIMIT_NONE,
        keep: limits?.keep ?? TRADE_LIMIT_NONE,
        ...carriedAsOf(ctx, goodType),
      },
    ];
  });
}

/** The first slot no stop fills, or null on a full route. */
function freeSlot(stops: readonly TradeStopView[]): number | null {
  for (let slot = 0; slot < TRADE_ROUTE_HOUSES; slot++) {
    if (!stops.some((stop) => stop.slot === slot)) return slot;
  }
  return null;
}

function shipNote(state: TraderShipState): TradeShipModel['note'] {
  const copy = messages().hud.settlerPanel;
  switch (state) {
    case 'needed':
      return { label: copy.tradeShipNeeded, tooltip: copy.tradeShipNeededTooltip };
    case 'unreachable':
      return { label: copy.tradeShipUnreachable, tooltip: copy.tradeShipUnreachableTooltip };
    case 'ready':
    case 'notNeeded':
      return null;
  }
}

function shipModel(ctx: UnitPanelModelContext, view: TraderView): TradeShipModel {
  const note = shipNote(view.shipState);
  if (view.ship === null) return { ship: null, note };
  const label = vehicleTitle(ctx, view.ship.vehicleType);
  return {
    ship: { entity: view.ship.entity, label, load: holdLoadLine(ctx, label, view.shipCargo) },
    note,
  };
}

/** The Trade model of one settler, or null for anything that is no trader. */
export function tradePanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entityId: number,
): TradePanelModel | null {
  const view = ctx.traderView?.(entityId);
  if (view === undefined) return null;
  const foreign = view.stops.find((stop) => stop.foreign);
  const stops: TradeStopModel[] = view.stops.map((stop, index) => ({
    slot: stop.slot,
    house: stop.house,
    label: houseLabel(ctx, snapshot, stop.house, stop.foreign),
    foreign: stop.foreign,
    heading: index === view.current,
    settlement: stop.settlement,
    settles: stop.settles,
    sharesSettlement: stop.sharesSettlement,
    settlementSuspended: stop.settlementSuspended,
  }));
  const a = view.stops.find((stop) => stop.slot === TRADE_SLOT_A);
  const b = view.stops.find((stop) => stop.slot === TRADE_SLOT_B);
  const own = foreign === undefined && a !== undefined && b !== undefined ? { a, b } : null;
  const offers: TradeOfferModel[] = (foreign?.offers ?? []).map((offer) => {
    const selected = offer.index === view.agreement;
    return {
      index: offer.index,
      label: tradeOfferLabel(ctx, offer),
      give: offerSide(ctx, offer.giveAmount, offer.giveGood),
      take: offerSide(ctx, offer.takeAmount, offer.takeGood),
      selected,
      progress: selected ? { given: view.given, received: view.received } : null,
    };
  });
  return {
    stops,
    attachSlot: freeSlot(view.stops),
    foreign: foreign !== undefined,
    stock:
      own === null
        ? null
        : { a: houseStock(ctx, snapshot, own.a.house), b: houseStock(ctx, snapshot, own.b.house) },
    transfers: own === null ? [] : transfersOf(ctx, own.a, own.b),
    offers,
    agreementHolds: view.agreementHolds,
    giveKeep: view.giveKeep,
    takeUpTo: view.takeUpTo,
    ship: shipModel(ctx, view),
  };
}
