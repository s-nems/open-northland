import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type SettlerPanelModel,
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeDirection,
  type TradeGoodModel,
  type TradePanelModel,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { type Counter, type CounterRange, createCounter } from '../parts/counter.js';
import {
  button,
  element,
  isDisabled,
  setAttribute,
  setClass,
  setDisabled,
  setTip,
  write,
} from '../parts/dom.js';
import type { SettlerPanelDeps } from './actions.js';
import { directionAllowed, directionChanges, goodOf, pressedDirection, routeHouses } from './trade-marks.js';
import { stopBadge } from './trade-stops.js';

/** Design px of the chosen good's icon in its well (foundation.css `.on-good-well`). */
const DETAIL_ICON_PX = 16;

/** The "do N" counter's ∞, which the sim reads as `TRADE_LIMIT_NONE`: no ceiling. */
const UP_TO_UNLIMITED = TRADE_LIMIT_MAX + 1;
/** "do N": 1 up to the top, then ∞; a ceiling of 0 would stop the good, which the direction does. */
const UP_TO_RANGE: CounterRange = { min: 1, max: TRADE_LIMIT_MAX, unlimited: UP_TO_UNLIMITED };
/** "zostaw N": a plain 0..top reserve, 0 keeping nothing back. */
const KEEP_RANGE: CounterRange = { max: TRADE_LIMIT_MAX };

const DIRECTIONS: readonly Exclude<TradeDirection, 'none'>[] = ['toA', 'both', 'toB'];

function directionLabel(direction: Exclude<TradeDirection, 'none'>): string {
  switch (direction) {
    case 'toA':
      return `→ ${stopBadge(TRADE_SLOT_A)}`;
    case 'toB':
      return `→ ${stopBadge(TRADE_SLOT_B)}`;
    case 'both':
      return '⇄';
  }
}

/** The mark a one-way good's limits sit on: the stop it is carried into, and the stop it comes from. */
function oneWayStops(direction: TradeDirection): { readonly into: number; readonly from: number } | null {
  if (direction === 'toA') return { into: TRADE_SLOT_A, from: TRADE_SLOT_B };
  if (direction === 'toB') return { into: TRADE_SLOT_B, from: TRADE_SLOT_A };
  return null;
}

function stopLabel(trade: TradePanelModel, slot: number): string {
  return trade.stops.find((stop) => stop.slot === slot)?.label ?? stopBadge(slot);
}

/** A direction segment's tooltip: what the press does, or which house cannot take the good. */
function directionTooltip(
  trade: TradePanelModel,
  good: TradeGoodModel,
  direction: Exclude<TradeDirection, 'none'>,
): string {
  const copy = messages().hud.settlerPanel;
  if (!directionAllowed(good, direction)) {
    const lacking = good.storedA ? TRADE_SLOT_B : TRADE_SLOT_A;
    return formatMessage(copy.tradeCannotStore, { house: stopLabel(trade, lacking) });
  }
  if (good.direction === direction) return copy.tradeStopCarrying;
  if (direction === 'both') return copy.tradeBalance;
  return formatMessage(copy.tradeCarryTo, {
    house: stopLabel(trade, direction === 'toA' ? TRADE_SLOT_A : TRADE_SLOT_B),
  });
}

/** The chosen good's line and controls; `good` null shows the hint and keeps the controls' place. */
export interface TradeDetail {
  readonly element: HTMLElement;
  update(trade: TradePanelModel, good: TradeGoodModel | null): void;
}

/**
 * The chosen good: its icon, name and both stocks, then the three-way direction (the lit option clears
 * the good) and, for a one-way good, the destination mark's "do N" ceiling and "zostaw N" reserve. The
 * block keeps its height whatever is chosen, so nothing below it moves.
 */
export function createTradeDetail(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
  chosen: () => number | null,
): TradeDetail {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const liveGood = (): { trade: TradePanelModel; good: TradeGoodModel } | null => {
    const trade = current()?.trade;
    const good = trade == null ? undefined : goodOf(trade, chosen());
    return trade == null || good === undefined ? null : { trade, good };
  };
  const turn = (direction: Exclude<TradeDirection, 'none'>): void => {
    const live = liveGood();
    const houses = live === null ? null : routeHouses(live.trade.stops);
    if (live === null || houses === null || !directionAllowed(live.good, direction)) return;
    const next = pressedDirection(live.good.direction, direction);
    const changes = directionChanges(live.good, next, houses);
    if (changes.length > 0) actions.setTradeMarks(id(), changes);
  };
  const setLimits = (limits: (good: TradeGoodModel) => { upTo: number; keep: number }): void => {
    const live = liveGood();
    if (live === null) return;
    const stops = oneWayStops(live.good.direction);
    const into = stops === null ? undefined : live.trade.stops.find((stop) => stop.slot === stops.into);
    if (into === undefined) return;
    const { upTo, keep } = limits(live.good);
    actions.setTradeImportLimits(id(), into.house, live.good.goodType, upTo, keep);
  };

  const root = element('div', 'on-trade-detail');
  const head = element('div', 'on-trade-detail__head');
  const well = element('span', 'on-good-well', goodIconMarkup(DETAIL_ICON_PX));
  const name = element('b', 'on-trade-detail__name');
  const stock = element('span', 'on-trade-detail__stock');
  head.append(well, name, stock);
  const strip = element('span', 'on-segmented on-trade-dir');
  strip.setAttribute('role', 'group');
  const segments = DIRECTIONS.map((direction) => {
    const option = button('', directionLabel(direction));
    option.addEventListener('click', () => {
      if (!isDisabled(option)) turn(direction);
    });
    strip.append(option);
    return { direction, option };
  });
  const limit = (text: string, counter: Counter): { row: HTMLElement; label: HTMLElement } => {
    const row = element('span', 'on-trade-limit');
    const label = element('span', 'on-trade-limit__label', text);
    row.append(label, counter.element);
    return { row, label };
  };
  const upTo = createCounter(UP_TO_RANGE, (next) =>
    setLimits((good) => ({ upTo: next >= UP_TO_UNLIMITED ? TRADE_LIMIT_NONE : next, keep: good.keep })),
  );
  const keep = createCounter(KEEP_RANGE, (next) => setLimits((good) => ({ upTo: good.upTo, keep: next })));
  const upToRow = limit('', upTo);
  const keepRow = limit('', keep);
  upToRow.row.classList.add('on-trade-limit--up-to');
  keepRow.row.classList.add('on-trade-limit--keep');
  root.append(head, strip, upToRow.row, keepRow.row);
  let shownIcon = '';

  return {
    element: root,
    update(trade, good): void {
      const copy = messages().hud.settlerPanel;
      setClass(root, 'on-trade-detail--idle', good === null);
      setAttribute(strip, 'aria-label', copy.tradeDirection);
      if (good === null) {
        write(name, copy.tradePickGood);
        write(stock, '');
        return;
      }
      const iconKey = good.goodId ?? '';
      if (iconKey !== shownIcon) {
        shownIcon = iconKey;
        well.innerHTML = goodIconMarkup(DETAIL_ICON_PX);
        const frame = well.querySelector('.on-good__frame');
        if (good.goodId !== undefined && frame instanceof HTMLElement)
          deps.icons(frame, good.goodId, DETAIL_ICON_PX);
      }
      write(name, good.label);
      write(stock, formatMessage(copy.tradeStock, { stockA: good.stockA, stockB: good.stockB }));
      for (const { direction, option } of segments) {
        setAttribute(option, 'aria-pressed', String(good.direction === direction));
        setDisabled(option, !directionAllowed(good, direction));
        const tip = directionTooltip(trade, good, direction);
        setTip(option, tip);
        setAttribute(option, 'aria-label', tip);
      }
      const stops = oneWayStops(good.direction);
      setClass(root, 'on-trade-detail--balanced', stops === null);
      if (stops === null) return;
      write(upToRow.label, copy.tradeUpTo);
      write(keepRow.label, copy.tradeKeep);
      setTip(upToRow.label, formatMessage(copy.tradeUpToTooltip, { house: stopLabel(trade, stops.into) }));
      setTip(keepRow.label, formatMessage(copy.tradeKeepTooltip, { house: stopLabel(trade, stops.from) }));
      upTo.update({
        value: good.upTo === TRADE_LIMIT_NONE ? UP_TO_UNLIMITED : good.upTo,
        lessLabel: copy.tradeUpToLess,
        moreLabel: copy.tradeUpToMore,
        lessTooltip: copy.tradeUpToLessTooltip,
        moreTooltip: copy.tradeUpToMoreTooltip,
      });
      keep.update({
        value: good.keep,
        lessLabel: copy.tradeKeepLess,
        moreLabel: copy.tradeKeepMore,
        lessTooltip: copy.tradeKeepLessTooltip,
        moreTooltip: formatMessage(copy.tradeKeepMoreTooltip, { max: TRADE_LIMIT_MAX }),
      });
    },
  };
}
