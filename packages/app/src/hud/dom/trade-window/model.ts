import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type SettlerPanelModel,
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeDirection,
  type TradePanelModel,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import { stockTabLabels } from '../../good-categories.js';
import { GLYPH } from '../icons.js';
import type { CategoryTab } from '../parts/category-tabs.js';
import type { CounterRange } from '../parts/counter.js';
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
/** "zostaw N": a plain 0..top reserve, 0 keeping nothing back. */
export const KEEP_RANGE: CounterRange = { max: TRADE_LIMIT_MAX };

/** The direction strip's options left to right: from A on the left to B on the right, balanced, back. */
export const DIRECTIONS: readonly TradeDirection[] = ['toB', 'both', 'toA'];

/** The trader's route while it is two own houses, the one thing the window shows; null closes it. */
export function windowRoute(model: SettlerPanelModel): TradePanelModel | null {
  return model.trade?.stock == null ? null : model.trade;
}

/** How many kinds of goods of `category` either house holds: the tab's count. */
export function stockedKinds(trade: TradePanelModel, category: number): number {
  const kinds = new Set<number>();
  for (const row of [...(trade.stock?.a ?? []), ...(trade.stock?.b ?? [])]) {
    if (row.category === category && row.amount > 0) kinds.add(row.goodType);
  }
  return kinds.size;
}

/** The eight category tabs: the kinds in stock, a lit dot where a transfer runs, both in the tooltip. */
export function categoryTabs(trade: TradePanelModel): CategoryTab[] {
  const copy = messages().hud.tradeWindow;
  return stockTabLabels().map((label, category) => {
    const count = stockedKinds(trade, category);
    const moving = trade.transfers.filter((transfer) => transfer.category === category).length;
    const stock =
      count > 0
        ? formatMessage(copy.tabTooltip, { category: label, count })
        : formatMessage(copy.tabEmptyTooltip, { category: label });
    const tooltip = moving > 0 ? `${stock} · ${formatMessage(copy.tabTransfers, { count: moving })}` : stock;
    return { label, count, marked: moving > 0, tooltip };
  });
}

/** The tab a new trader opens on: the first category either house holds anything of. */
export function firstStockedTab(trade: TradePanelModel): number {
  const categories = stockTabLabels().length;
  for (let category = 0; category < categories; category++) {
    if (stockedKinds(trade, category) > 0) return category;
  }
  return 0;
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
 *  other house", refused while that house does not store the good. */
function rowAction(trade: TradePanelModel, slot: number, goodType: number, label: string): StockRowAction {
  const copy = messages().hud.tradeWindow;
  const other = otherSlot(slot);
  const house = stopLabel(trade, other);
  const badge = stopBadge(other);
  const good = tradeGood(trade, goodType);
  const flow = good?.flow ?? 'none';
  const glyph = arrowGlyph(flow, slot);
  if (flow !== 'none') {
    const tooltip =
      flow === 'both'
        ? copy.balanced
        : formatMessage(flow === outOf(slot) ? copy.carriedOut : copy.carriedIn, { badge, house });
    return {
      glyph,
      label: formatMessage(copy.stopLabel, { good: label }),
      tooltip,
      pressed: true,
      enabled: true,
    };
  }
  const enabled = good !== null && flowAllowed(good, outOf(slot));
  return {
    glyph,
    label: formatMessage(copy.carryLabel, { good: label, badge }),
    tooltip: enabled
      ? formatMessage(copy.carryTo, { badge, house })
      : formatMessage(copy.cannotStore, { house }),
    pressed: false,
    enabled,
  };
}

/** The stock rows of the house in `slot` for the open category, in its stock table's order. */
export function houseRows(trade: TradePanelModel, slot: number, category: number): StockBrowserRow[] {
  const copy = messages().hud.tradeWindow;
  const rows = (slot === TRADE_SLOT_A ? trade.stock?.a : trade.stock?.b) ?? [];
  return rows
    .filter((row) => row.category === category)
    .map((row) => {
      const there = stockAt(trade, otherSlot(slot), row.goodType)?.amount ?? 0;
      const [stockA, stockB] = slot === TRADE_SLOT_A ? [row.amount, there] : [there, row.amount];
      return {
        goodType: row.goodType,
        ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
        label: row.label,
        amount: row.amount,
        capacity: row.capacity,
        tooltip: formatMessage(copy.rowTooltip, { good: row.label, stockA, stockB }),
        action: rowAction(trade, slot, row.goodType, row.label),
      };
    });
}

export interface DirectionOption {
  readonly direction: TradeDirection;
  readonly label: string;
  readonly pressed: boolean;
  readonly enabled: boolean;
  readonly tooltip: string;
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
  readonly directions: readonly DirectionOption[];
  /** Null on a balanced line: the counters keep their place, hidden. */
  readonly limits: TransferLimits | null;
}

function directionLabel(direction: TradeDirection): string {
  const stops = oneWayStops(direction);
  return stops === null ? '⇄' : `${stopBadge(stops.from)} → ${stopBadge(stops.into)}`;
}

/** One line of Przewozy: the three directions (the lit one is the transfer's, one into a house that
 *  does not store the good refused with the reason) and a one-way transfer's limits. */
export function transferLine(trade: TradePanelModel, transfer: TradeTransferModel): TransferLine {
  const copy = messages().hud.tradeWindow;
  const good = tradeGood(trade, transfer.goodType);
  const directions = DIRECTIONS.map((direction): DirectionOption => {
    const enabled = good === null || flowAllowed(good, direction);
    const stops = oneWayStops(direction);
    const lacking = good?.storedA === false ? TRADE_SLOT_A : TRADE_SLOT_B;
    const tooltip = !enabled
      ? formatMessage(copy.cannotStore, { house: stopLabel(trade, lacking) })
      : stops === null
        ? copy.balance
        : formatMessage(copy.carryFromTo, { from: stopBadge(stops.from), into: stopBadge(stops.into) });
    return {
      direction,
      label: directionLabel(direction),
      pressed: transfer.direction === direction,
      enabled,
      tooltip,
    };
  });
  const stops = oneWayStops(transfer.direction);
  return {
    goodType: transfer.goodType,
    label: transfer.label,
    directions,
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
