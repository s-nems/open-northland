import { formatMessage, messages } from '../../../i18n/index.js';
import {
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { element, setTip, write } from '../parts/dom.js';
import { oneWayStops, stopBadge } from '../trade-window/route.js';
import type { SettlerPanelDeps } from './actions.js';

/** Design px of a transfer's good in its well (foundation.css `.on-good-well`). */
const LINE_ICON_PX = 16;

/** "A → B · do 10 · zostaw 2", or "A ⇄ B" for a balanced good. */
export function transferSummary(transfer: TradeTransferModel): string {
  const copy = messages().hud.settlerPanel;
  const stops = oneWayStops(transfer.direction);
  if (stops === null) {
    return formatMessage(copy.tradeTransferBoth, { a: stopBadge(TRADE_SLOT_A), b: stopBadge(TRADE_SLOT_B) });
  }
  const parts = [
    formatMessage(copy.tradeTransferTo, { from: stopBadge(stops.from), into: stopBadge(stops.into) }),
  ];
  if (transfer.upTo !== TRADE_LIMIT_NONE)
    parts.push(formatMessage(copy.tradeTransferUpTo, { count: transfer.upTo }));
  if (transfer.keep !== TRADE_LIMIT_NONE)
    parts.push(formatMessage(copy.tradeTransferKeep, { count: transfer.keep }));
  return parts.join(' · ');
}

/** The same transfer in words, for the line's tooltip. */
export function transferTooltip(transfer: TradeTransferModel): string {
  const copy = messages().hud.settlerPanel;
  const stops = oneWayStops(transfer.direction);
  if (stops === null) {
    return formatMessage(copy.tradeTransferTooltipBoth, {
      good: transfer.label,
      a: stopBadge(TRADE_SLOT_A),
      b: stopBadge(TRADE_SLOT_B),
    });
  }
  const from = stopBadge(stops.from);
  const into = stopBadge(stops.into);
  const parts = [formatMessage(copy.tradeTransferTooltipTo, { good: transfer.label, from, into })];
  if (transfer.upTo !== TRADE_LIMIT_NONE) {
    parts.push(formatMessage(copy.tradeTransferTooltipUpTo, { into, count: transfer.upTo }));
  }
  if (transfer.keep !== TRADE_LIMIT_NONE) {
    parts.push(formatMessage(copy.tradeTransferTooltipKeep, { from, count: transfer.keep }));
  }
  return parts.join(', ');
}

interface LineView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly summary: HTMLElement;
}

/** The route's transfers as read-only ledger lines: the good's icon and name, its direction and
 *  limits; the tooltip says it in words. The trade window is where they change. */
export interface TradeTransfers {
  readonly element: HTMLElement;
  update(transfers: readonly TradeTransferModel[]): void;
}

export function createTradeTransfers(deps: SettlerPanelDeps): TradeTransfers {
  const list = element('ul', 'on-trade-lines');
  let shown = '';
  let views: LineView[] = [];

  const lineView = (transfer: TradeTransferModel): LineView => {
    const item = element('li', 'on-ledger on-trade-line');
    const well = element('span', 'on-good-well', goodIconMarkup(LINE_ICON_PX));
    const frame = well.querySelector('.on-good__frame');
    if (transfer.goodId !== undefined && frame instanceof HTMLElement) {
      deps.icons(frame, transfer.goodId, LINE_ICON_PX);
    }
    const name = element('span', 'on-trade-line__name');
    const summary = element('b', 'on-trade-line__summary');
    item.append(well, name, summary);
    return { item, name, summary };
  };

  return {
    element: list,
    update(transfers): void {
      const key = transfers.map((transfer) => `${transfer.goodType}:${transfer.goodId ?? ''}`).join(',');
      if (key !== shown) {
        shown = key;
        views = transfers.map(lineView);
        list.replaceChildren(...views.map((view) => view.item));
      }
      transfers.forEach((transfer, index) => {
        const view = views[index];
        if (view === undefined) return;
        write(view.name, transfer.label);
        write(view.summary, transferSummary(transfer));
        setTip(view.item, transferTooltip(transfer));
      });
    },
  };
}
