import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import {
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setHidden, setTip, write } from '../parts/dom.js';
import { oneWayStops, stopBadge, TRANSFER_ICON_PX } from '../trade-window/route.js';
import type { SettlerPanelDeps } from './actions.js';

/** "A → B · up to 10 · keep 2", or "A ⇄ B" for a balanced good. */
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

/** What the free height keeps: the first `lines` transfers, then, when `more` is above 0, one line
 *  linking to the trade window for the `more` left out. */
export interface TransferFit {
  readonly lines: number;
  readonly more: number;
}

/**
 * The lines that fit when the panel, with every one of the `total` lines shown, stands `overflow` px
 * past the plane: as many lines go as that takes, and the last line kept becomes the link to the
 * window. Null when not even the link fits, so the section folds.
 */
export function fitTransferLines(total: number, overflow: number, lineHeight: number): TransferFit | null {
  if (overflow <= 0 || total === 0) return { lines: total, more: 0 };
  const slots = total - Math.ceil(overflow / Math.max(1, lineHeight));
  if (slots < 1) return null;
  const lines = slots - 1;
  return { lines, more: total - lines };
}

interface LineView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly summary: HTMLElement;
}

/** The route's transfers as read-only ledger lines: the good's icon and name, its direction and
 *  limits; the tooltip says it in words. The trade window is where they change. The panel's fit pass
 *  may cap the lines, the last one kept then linking to the window for the rest. */
export interface TradeTransfers {
  readonly element: HTMLElement;
  update(transfers: readonly TradeTransferModel[]): void;
  /** Show every line, for the fit pass to measure the section in full. */
  uncap(): void;
  cap(fit: TransferFit): void;
  /** Layout px of one line, 0 while none is laid out. */
  lineHeight(): number;
}

export function createTradeTransfers(deps: SettlerPanelDeps, onOpenWindow: () => void): TradeTransfers {
  const list = element('ul', 'on-trade-lines');
  const moreItem = element('li', 'on-trade-line on-trade-line--more');
  const moreLink = button('on-more on-trade-line__more');
  moreLink.addEventListener('click', onOpenWindow);
  moreItem.append(moreLink);
  let shown = '';
  let views: LineView[] = [];
  let fit: TransferFit | null = null;

  const lineView = (transfer: TradeTransferModel): LineView => {
    const item = element('li', 'on-trade-line');
    const well = element('span', 'on-good-well', goodIconMarkup(TRANSFER_ICON_PX));
    const frame = well.querySelector('.on-good__frame');
    if (transfer.goodId !== undefined && frame instanceof HTMLElement) {
      deps.icons(frame, transfer.goodId, TRANSFER_ICON_PX);
    }
    const name = element('span', 'on-trade-line__name');
    const summary = element('b', 'on-trade-line__summary');
    item.append(well, name, summary);
    return { item, name, summary };
  };

  const paintCap = (): void => {
    const kept = fit === null ? views.length : Math.min(fit.lines, views.length);
    views.forEach((view, index) => {
      setHidden(view.item, index >= kept);
    });
    const more = fit === null ? 0 : views.length - kept;
    setHidden(moreItem, more === 0);
    if (more === 0) return;
    const copy = messages().hud.settlerPanel;
    write(
      moreLink,
      formatMessage(copy.tradeMoreTransfers, {
        more: formatMessage(pluralForm(more, copy.tradeTransferCount, bcp47Tag()), { count: more }),
      }),
    );
    setTip(moreLink, copy.tradeMoreTransfersTooltip);
  };

  return {
    element: list,
    update(transfers): void {
      const key = transfers.map((transfer) => `${transfer.goodType}:${transfer.goodId ?? ''}`).join(',');
      if (key !== shown) {
        shown = key;
        views = transfers.map(lineView);
        list.replaceChildren(...views.map((view) => view.item), moreItem);
        paintCap();
      }
      transfers.forEach((transfer, index) => {
        const view = views[index];
        if (view === undefined) return;
        write(view.name, transfer.label);
        write(view.summary, transferSummary(transfer));
        setTip(view.item, transferTooltip(transfer));
      });
    },
    uncap(): void {
      if (fit === null) return;
      fit = null;
      paintCap();
    },
    cap(next): void {
      fit = next;
      paintCap();
    },
    lineHeight(): number {
      const line = views.find((view) => !view.item.hidden);
      return line?.item.offsetHeight ?? 0;
    },
  };
}
