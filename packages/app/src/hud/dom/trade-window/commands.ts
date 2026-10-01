import { TRADE_LIMIT_NONE, type TradePanelModel } from '../../details-panel/model/index.js';
import type { SettlerPanelActions } from '../settler-panel/actions.js';
import { UP_TO_UNLIMITED } from './model.js';
import {
  flowAllowed,
  flowChanges,
  oneWayStops,
  routeHouses,
  rowPress,
  type TradeFlow,
  tradeGood,
} from './route.js';

/** The trader the window shows and its route as last painted; null while the window is closed. */
export interface TradeWindowSubject {
  readonly trader: number;
  readonly trade: TradePanelModel;
}

/** What the window's controls ask the sim for, read against the route as last painted. */
export interface TradeCommands {
  /** A stock row's arrow in the house in `slot`: add the transfer into the other house, balance it with
   *  Ctrl, or remove a transfer the good is in. */
  arrow(slot: number, goodType: number, ctrl: boolean): void;
  /** A direction option, or ✕ with `none`. */
  setFlow(goodType: number, flow: TradeFlow): void;
  /** A one-way transfer's counters: "up to" as the counter shows it (∞ above the top), "keep" in units. */
  setLimits(goodType: number, upTo: number, keep: number): void;
}

export function createTradeCommands(
  actions: Pick<SettlerPanelActions, 'setTradeMarks' | 'setTradeImportLimits'>,
  subject: () => TradeWindowSubject | null,
): TradeCommands {
  const turn = (goodType: number, next: (was: TradeFlow) => TradeFlow): void => {
    const live = subject();
    const houses = live === null ? null : routeHouses(live.trade.stops);
    const good = live === null ? null : tradeGood(live.trade, goodType);
    if (live === null || houses === null || good === null) return;
    const flow = next(good.flow);
    if (!flowAllowed(good, flow)) return;
    const changes = flowChanges(good, flow, houses);
    if (changes.length > 0) actions.setTradeMarks(live.trader, changes);
  };
  return {
    arrow: (slot, goodType, ctrl) => turn(goodType, (was) => rowPress(was, slot, ctrl)),
    setFlow: (goodType, flow) => turn(goodType, () => flow),
    setLimits(goodType, upTo, keep): void {
      const live = subject();
      const transfer = live?.trade.transfers.find((candidate) => candidate.goodType === goodType);
      const stops = transfer === undefined ? null : oneWayStops(transfer.direction);
      const into = stops === null ? undefined : live?.trade.stops.find((stop) => stop.slot === stops.into);
      if (live === null || into === undefined) return;
      const ceiling = upTo >= UP_TO_UNLIMITED ? TRADE_LIMIT_NONE : upTo;
      actions.setTradeImportLimits(live.trader, into.house, goodType, ceiling, keep);
    },
  };
}
