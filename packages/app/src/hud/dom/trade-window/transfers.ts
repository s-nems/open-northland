import { formatMessage, messages } from '../../../i18n/index.js';
import {
  TRADE_LIMIT_MAX,
  type TradePanelModel,
  type TradeTransferModel,
} from '../../details-panel/model/index.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { type Counter, createCounter } from '../parts/counter.js';
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
import { createRoundButton, type RoundButton } from '../parts/round-button.js';
import { DIRECTIONS, KEEP_RANGE, type TransferLine, transferLine, UP_TO_RANGE } from './model.js';
import type { TradeFlow } from './route.js';

/** Design px of a transfer's good in its well (foundation.css `.on-good-well`). */
const LINE_ICON_PX = 16;

export interface TransfersDeps {
  readonly icons: GoodIconPainter;
  /** Turn the good to `flow`; none removes the transfer. */
  readonly setFlow: (goodType: number, flow: TradeFlow) => void;
  /** The counters' values: "do" as shown (∞ above the top), "zostaw" in units. */
  readonly setLimits: (goodType: number, upTo: number, keep: number) => void;
}

interface LineView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly strip: HTMLElement;
  readonly options: readonly HTMLButtonElement[];
  readonly upToLabel: HTMLElement;
  readonly keepLabel: HTMLElement;
  readonly upTo: Counter;
  readonly keep: Counter;
  readonly remove: RoundButton;
}

/**
 * Przewozy: one line per transfer, the good, a three-way direction strip ("A → B", "⇄", "B → A"; the
 * lit option stays, ✕ removes), and for a one-way transfer the destination's "do N" ceiling and the
 * source's "zostaw N" reserve, which keep their place, hidden, on a balanced line so the columns
 * line up. Lines are rebuilt only when the set of goods changes; a tick rewrites their words.
 */
export interface TransfersList {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
}

export function createTransfersList(deps: TransfersDeps): TransfersList {
  const root = element('div', 'on-transfers');
  const list = element('ul', 'on-transfers__list');
  const empty = element('p', 'on-transfers__empty');
  root.append(list, empty);
  let shown = '';
  let views = new Map<number, LineView>();
  /** Each line's model as last painted, so a counter press reads the other counter's live value. */
  let lines = new Map<number, TransferLine>();

  const lineView = (transfer: TradeTransferModel): LineView => {
    const goodType = transfer.goodType;
    const item = element('li', 'on-transfer');
    const well = element('span', 'on-good-well', goodIconMarkup(LINE_ICON_PX));
    const frame = well.querySelector('.on-good__frame');
    if (transfer.goodId !== undefined && frame instanceof HTMLElement) {
      deps.icons(frame, transfer.goodId, LINE_ICON_PX);
    }
    const name = element('span', 'on-transfer__name');
    const strip = element('span', 'on-segmented on-transfer__direction');
    strip.setAttribute('role', 'group');
    const options = DIRECTIONS.map((direction) => {
      const option = button('');
      option.addEventListener('click', () => {
        if (isDisabled(option) || option.getAttribute('aria-pressed') === 'true') return;
        deps.setFlow(goodType, direction);
      });
      strip.append(option);
      return option;
    });
    const counterRow = (counter: Counter, modifier: string): { row: HTMLElement; label: HTMLElement } => {
      const row = element('span', `on-trade-limit ${modifier}`);
      const label = element('span', 'on-trade-limit__label');
      row.append(label, counter.element);
      return { row, label };
    };
    // Each counter sends both limits: the other one as the line last showed it.
    const upTo = createCounter(UP_TO_RANGE, (next) => {
      const limits = lines.get(goodType)?.limits;
      if (limits != null) deps.setLimits(goodType, next, limits.keep);
    });
    const keep = createCounter(KEEP_RANGE, (next) => {
      const limits = lines.get(goodType)?.limits;
      if (limits != null) deps.setLimits(goodType, limits.upTo, next);
    });
    const upToRow = counterRow(upTo, 'on-trade-limit--up-to');
    const keepRow = counterRow(keep, 'on-trade-limit--keep');
    const remove = createRoundButton('ledger', () => deps.setFlow(goodType, 'none'));
    item.append(well, name, strip, upToRow.row, keepRow.row, remove.element);
    return {
      item,
      name,
      strip,
      options,
      upToLabel: upToRow.label,
      keepLabel: keepRow.label,
      upTo,
      keep,
      remove,
    };
  };

  const paintLine = (view: LineView, line: TransferLine): void => {
    const copy = messages().hud.tradeWindow;
    write(view.name, line.label);
    setTip(view.name, line.label);
    setAttribute(view.strip, 'aria-label', formatMessage(copy.direction, { good: line.label }));
    line.directions.forEach((direction, index) => {
      const option = view.options[index];
      if (option === undefined) return;
      write(option, direction.label);
      setAttribute(option, 'aria-pressed', String(direction.pressed));
      setDisabled(option, !direction.enabled);
      setTip(option, direction.tooltip);
      setAttribute(option, 'aria-label', direction.tooltip);
    });
    view.remove.update({
      face: { glyph: GLYPH.close },
      label: formatMessage(copy.removeLabel, { good: line.label }),
      tooltip: copy.remove,
    });
    setClass(view.item, 'on-transfer--balanced', line.limits === null);
    write(view.upToLabel, copy.upTo);
    write(view.keepLabel, copy.keep);
    if (line.limits === null) return;
    setTip(view.upToLabel, line.limits.upToTooltip);
    setTip(view.keepLabel, line.limits.keepTooltip);
    view.upTo.update({
      value: line.limits.upTo,
      lessLabel: copy.upToLess,
      moreLabel: copy.upToMore,
      lessTooltip: copy.upToLessTooltip,
      moreTooltip: copy.upToMoreTooltip,
    });
    view.keep.update({
      value: line.limits.keep,
      lessLabel: copy.keepLess,
      moreLabel: copy.keepMore,
      lessTooltip: copy.keepLessTooltip,
      moreTooltip: formatMessage(copy.keepMoreTooltip, { max: TRADE_LIMIT_MAX }),
    });
  };

  return {
    element: root,
    update(trade): void {
      lines = new Map(trade.transfers.map((transfer) => [transfer.goodType, transferLine(trade, transfer)]));
      const key = trade.transfers.map((transfer) => transfer.goodType).join(',');
      if (key !== shown) {
        shown = key;
        views = new Map(trade.transfers.map((transfer) => [transfer.goodType, lineView(transfer)]));
        list.replaceChildren(...[...views.values()].map((view) => view.item));
      }
      write(empty, trade.transfers.length === 0 ? messages().hud.tradeWindow.transfersEmpty : '');
      setClass(root, 'on-transfers--empty', trade.transfers.length === 0);
      for (const [goodType, line] of lines) {
        const view = views.get(goodType);
        if (view !== undefined) paintLine(view, line);
      }
    },
  };
}
