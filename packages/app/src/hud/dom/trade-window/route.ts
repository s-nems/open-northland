import {
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeDirection,
  type TradePanelModel,
  type TradeStockRow,
  type TradeStopModel,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import type { TradeMarkChange } from '../settler-panel/actions.js';

/** Design px of a transfer line's good in its well (foundation.css `.on-good-well`), in the settler
 *  panel's Trade and in the trade window alike. */
export const TRANSFER_ICON_PX = 16;

/** A good's flow on the route: a transfer's direction, or none while it is not marked. */
export type TradeFlow = TradeDirection | 'none';

/** The route's stops by slot: A is the first house, B the second. Letters, not words, in every locale. */
const STOP_BADGES: readonly string[] = ['A', 'B'];

export function stopBadge(slot: number): string {
  return STOP_BADGES[slot] ?? String(slot + 1);
}

/** Where each flow puts the good's marks: at A (carried into A), at B, or both (balanced). */
const MARKED_AT: Readonly<Record<TradeFlow, { readonly a: boolean; readonly b: boolean }>> = {
  none: { a: false, b: false },
  toA: { a: true, b: false },
  toB: { a: false, b: true },
  both: { a: true, b: true },
};

/** One good as the route moves it, with the stores that can take it in. */
export interface TradeGood {
  readonly goodType: number;
  readonly flow: TradeFlow;
  readonly upTo: number;
  readonly keep: number;
  readonly storedA: boolean;
  readonly storedB: boolean;
}

export interface RouteHouses {
  readonly a: number;
  readonly b: number;
}

/** The houses of a two-stop route by slot, or null while the route is shorter. */
export function routeHouses(stops: readonly TradeStopModel[]): RouteHouses | null {
  const a = stops.find((stop) => stop.slot === TRADE_SLOT_A)?.house;
  const b = stops.find((stop) => stop.slot === TRADE_SLOT_B)?.house;
  return a === undefined || b === undefined ? null : { a, b };
}

/** The house at the stop in `slot`, or null while the slot is free. */
export function stopHouse(trade: TradePanelModel, slot: number): number | null {
  return trade.stops.find((stop) => stop.slot === slot)?.house ?? null;
}

/** A reopened window keeps a house's open tab only for the same trader and the same house in the slot:
 *  a stop changed between opens is another house's stock. */
export function keepsOpenTab(
  sameTrader: boolean,
  shownHouse: number | null,
  nextHouse: number | null,
): boolean {
  return sameTrader && shownHouse !== null && shownHouse === nextHouse;
}

export function stopLabel(trade: TradePanelModel, slot: number): string {
  return trade.stops.find((stop) => stop.slot === slot)?.label ?? stopBadge(slot);
}

/** The stock row of `goodType` at the stop in `slot`, while that house stores it. */
export function stockAt(trade: TradePanelModel, slot: number, goodType: number): TradeStockRow | undefined {
  const rows = slot === TRADE_SLOT_A ? trade.stock?.a : trade.stock?.b;
  return rows?.find((row) => row.goodType === goodType);
}

export function transferOf(trade: TradePanelModel, goodType: number): TradeTransferModel | undefined {
  return trade.transfers.find((transfer) => transfer.goodType === goodType);
}

/** The good as the route moves it now; null on a route that is not two own stops. */
export function tradeGood(trade: TradePanelModel, goodType: number): TradeGood | null {
  if (trade.stock === null) return null;
  const transfer = transferOf(trade, goodType);
  return {
    goodType,
    flow: transfer?.direction ?? 'none',
    upTo: transfer?.upTo ?? TRADE_LIMIT_NONE,
    keep: transfer?.keep ?? TRADE_LIMIT_NONE,
    storedA: stockAt(trade, TRADE_SLOT_A, goodType) !== undefined,
    storedB: stockAt(trade, TRADE_SLOT_B, goodType) !== undefined,
  };
}

/** Whether the good can move `flow`: every house it is carried into must store it. */
export function flowAllowed(good: TradeGood, flow: TradeFlow): boolean {
  const marks = MARKED_AT[flow];
  return (!marks.a || good.storedA) && (!marks.b || good.storedB);
}

/**
 * The mark changes that turn `good` to `to`. A mark kept for the balance is cleared and set again when
 * it had limits: the balanced flow shows no counters, so it must carry none.
 */
export function flowChanges(good: TradeGood, to: TradeFlow, houses: RouteHouses): TradeMarkChange[] {
  const was = MARKED_AT[good.flow];
  const will = MARKED_AT[to];
  const limited = good.upTo !== TRADE_LIMIT_NONE || good.keep !== TRADE_LIMIT_NONE;
  const changes: TradeMarkChange[] = [];
  for (const side of ['a', 'b'] as const) {
    const house = houses[side];
    if (was[side] !== will[side]) changes.push({ house, goodType: good.goodType, on: will[side] });
    else if (will[side] && to === 'both' && limited) {
      changes.push(
        { house, goodType: good.goodType, on: false },
        { house, goodType: good.goodType, on: true },
      );
    }
  }
  return changes;
}

/** The one-way flow out of the house in `slot`: into the other stop. */
export function outOf(slot: number): TradeDirection {
  return slot === TRADE_SLOT_A ? 'toB' : 'toA';
}

/**
 * A stock row's arrow press in the house in `slot`: a good in any transfer drops out of the route; a
 * free one is carried into the other house, or balanced with Ctrl. Ctrl on a one-way good balances it.
 */
export function rowPress(flow: TradeFlow, slot: number, ctrl: boolean): TradeFlow {
  if (ctrl) return flow === 'both' ? 'none' : 'both';
  return flow === 'none' ? outOf(slot) : 'none';
}

/** The stop a one-way flow fills and the stop it draws from; null for a balanced flow. */
export function oneWayStops(flow: TradeFlow): { readonly into: number; readonly from: number } | null {
  if (flow === 'toA') return { into: TRADE_SLOT_A, from: TRADE_SLOT_B };
  if (flow === 'toB') return { into: TRADE_SLOT_B, from: TRADE_SLOT_A };
  return null;
}
