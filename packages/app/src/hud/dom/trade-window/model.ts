import { formatMessage, messages } from '../../../i18n/index.js';
import {
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeDirection,
  type TradePanelModel,
  type TraderSubject,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import type { CounterRange } from '../parts/counter.js';
import type { SegmentedOption } from '../parts/segmented.js';
import type { StockBrowserRow, StockRowAction } from '../parts/stock-browser.js';
import {
  flowAllowed,
  oneWayStops,
  outOf,
  stockAt,
  stopBadge,
  stopLabel,
  type TradeFlow,
  tradeGood,
} from './route.js';

/** The "do N" counter's ∞, which the sim reads as `TRADE_LIMIT_NONE`: no ceiling. */
export const UP_TO_UNLIMITED = TRADE_LIMIT_MAX + 1;
/** "do N": 1 up to the top, then ∞; a ceiling of 0 would stop the good, which ✕ does. */
export const UP_TO_RANGE: CounterRange = { min: 1, max: TRADE_LIMIT_MAX, unlimited: UP_TO_UNLIMITED };
/** "keep N": a plain 0..top reserve, 0 keeping nothing back. */
export const KEEP_RANGE: CounterRange = { max: TRADE_LIMIT_MAX };

/** The direction strip's options left to right: from A on the left to B on the right, balanced, back. */
export const DIRECTIONS: readonly TradeDirection[] = ['toB', 'both', 'toA'];

/** The trader's route while it is two own houses, the one thing the window shows; null closes it. */
export function windowRoute(model: TraderSubject): TradePanelModel | null {
  return model.trade?.stock == null ? null : model.trade;
}

function otherSlot(slot: number): number {
  return slot === TRADE_SLOT_A ? TRADE_SLOT_B : TRADE_SLOT_A;
}

/** The glyph a row's arrow shows from the point of view of the house in `slot`. */
function arrowGlyph(flow: TradeFlow, slot: number): string {
  if (flow === 'both') return GLYPH.swap;
  const pointsOut = flow === 'none' || flow === outOf(slot);
  // A sits left of B: out of A points right, out of B points left.
  return pointsOut === (slot === TRADE_SLOT_A) ? GLYPH.arrow : GLYPH.arrowLeft;
}

/** A stock row's arrow: lit while the good is in a transfer (a press removes it), else "carry into the
 *  other house", refused while that house does not store the good. Its name says all that; only the
 *  refused arrow shows a tooltip, with the reason. */
function rowAction(trade: TradePanelModel, slot: number, goodType: number, label: string): StockRowAction {
  const copy = messages().hud.tradeWindow;
  const other = otherSlot(slot);
  const house = stopLabel(trade, other);
  const badge = stopBadge(other);
  const good = tradeGood(trade, goodType);
  const flow = good?.flow ?? 'none';
  const glyph = arrowGlyph(flow, slot);
  if (flow !== 'none') {
    return {
      glyph,
      label: formatMessage(copy.stopLabel, { good: label }),
      tooltip: '',
      pressed: true,
      enabled: true,
    };
  }
  const enabled = good !== null && flowAllowed(good, outOf(slot));
  return {
    glyph,
    label: formatMessage(copy.carryLabel, { good: label, badge }),
    tooltip: enabled ? '' : formatMessage(copy.cannotStore, { house }),
    pressed: false,
    enabled,
  };
}

/** Every good the house in `slot` stores, in its stock table's order; the browser lists a tab's. */
export function houseRows(trade: TradePanelModel, slot: number): StockBrowserRow[] {
  const copy = messages().hud.tradeWindow;
  const rows = (slot === TRADE_SLOT_A ? trade.stock?.a : trade.stock?.b) ?? [];
  const moving = new Set(trade.transfers.map((transfer) => transfer.goodType));
  return rows.map((row) => {
    const there = stockAt(trade, otherSlot(slot), row.goodType)?.amount ?? 0;
    const [stockA, stockB] = slot === TRADE_SLOT_A ? [row.amount, there] : [there, row.amount];
    return {
      goodType: row.goodType,
      ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
      label: row.label,
      category: row.category,
      marked: moving.has(row.goodType),
      amount: row.amount,
      capacity: row.capacity,
      tooltip: formatMessage(copy.rowTooltip, { good: row.label, stockA, stockB }),
      action: rowAction(trade, slot, row.goodType, row.label),
    };
  });
}

/** A one-way transfer's two counters: the ceiling in the house it fills, the reserve in the source. */
export interface TransferLimits {
  /** The "do" counter's value: the ceiling, or {@link UP_TO_UNLIMITED} for none. */
  readonly upTo: number;
  readonly keep: number;
  readonly upToTooltip: string;
  readonly keepTooltip: string;
}

export interface TransferLine {
  readonly goodType: number;
  readonly label: string;
  /** The direction strip's options; the lit one is {@link TransferLine.chosen}. */
  readonly directions: Readonly<Record<TradeDirection, SegmentedOption>>;
  readonly chosen: TradeDirection;
  /** Null on a balanced line: the counters keep their place, hidden. */
  readonly limits: TransferLimits | null;
}

function directionLabel(direction: TradeDirection): string {
  const stops = oneWayStops(direction);
  return stops === null ? '⇄' : `${stopBadge(stops.from)} → ${stopBadge(stops.into)}`;
}

/** One line of Transfers: the three directions (the lit one is the transfer's, one into a house that
 *  does not store the good refused with the reason) and a one-way transfer's limits. */
export function transferLine(trade: TradePanelModel, transfer: TradeTransferModel): TransferLine {
  const copy = messages().hud.tradeWindow;
  const good = tradeGood(trade, transfer.goodType);
  const option = (direction: TradeDirection): SegmentedOption => {
    const enabled = good === null || flowAllowed(good, direction);
    const stops = oneWayStops(direction);
    const lacking = good?.storedA === false ? TRADE_SLOT_A : TRADE_SLOT_B;
    const tooltip = !enabled
      ? formatMessage(copy.cannotStore, { house: stopLabel(trade, lacking) })
      : stops === null
        ? copy.balance
        : formatMessage(copy.carryFromTo, { from: stopBadge(stops.from), into: stopBadge(stops.into) });
    return { label: directionLabel(direction), enabled, tooltip };
  };
  const stops = oneWayStops(transfer.direction);
  return {
    goodType: transfer.goodType,
    label: transfer.label,
    directions: { toA: option('toA'), toB: option('toB'), both: option('both') },
    chosen: transfer.direction,
    limits:
      stops === null
        ? null
        : {
            upTo: transfer.upTo === TRADE_LIMIT_NONE ? UP_TO_UNLIMITED : transfer.upTo,
            keep: transfer.keep,
            upToTooltip: formatMessage(copy.upToTooltip, { house: stopLabel(trade, stops.into) }),
            keepTooltip: formatMessage(copy.keepTooltip, { house: stopLabel(trade, stops.from) }),
          },
  };
}
