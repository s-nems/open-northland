import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { element, setAttribute, setClass, setTip, write } from './dom.js';
import { createRoundButton, type RoundButton } from './round-button.js';

/** Design px of a good's icon on a stock row (foundation.css `.on-stock-row`). */
const ROW_ICON_PX = 22;

/** A row's one button: a glyph that does what the owner of the browser says. */
export interface StockRowAction {
  readonly glyph: string;
  readonly label: string;
  readonly tooltip: string;
  /** Lit while the row's good is in whatever state the button toggles. */
  readonly pressed: boolean;
  readonly enabled: boolean;
}

/** One good a house stores: its amount against its shelf. */
export interface StockBrowserRow {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  readonly capacity: number;
  /** The tooltip over the good's name and numbers; empty for none. */
  readonly tooltip: string;
  readonly action: StockRowAction | null;
}

export interface StockBrowserModel {
  /** The accessible name of the list. */
  readonly label: string;
  readonly rows: readonly StockBrowserRow[];
  /** The line shown while there are no rows. */
  readonly empty: string;
}

/**
 * A house's stock as a list: per good the icon, the name, "amount / shelf" and a thin meter, and an
 * optional button the owner defines. It knows nothing of what the button means: the trade window
 * uses it for its two houses, and the building window is meant to reuse it for a house's stock.
 *
 * Goods in stock lead and the empty ones follow faded, in the owner's order within each group. That
 * order is taken when the set of goods changes (another category, another house) or on `reset`, and
 * kept while only amounts change, so a row never moves under the cursor as the sim ticks. The list
 * scrolls inside itself; the owner sizes it.
 */
export interface StockBrowser {
  readonly element: HTMLElement;
  update(model: StockBrowserModel): void;
  /** Another subject (a new trader, a reopened window): order and scroll are taken afresh. */
  reset(): void;
}

interface RowView {
  readonly item: HTMLLIElement;
  readonly info: HTMLElement;
  readonly name: HTMLElement;
  readonly amount: HTMLElement;
  readonly meter: HTMLElement;
  readonly action: RoundButton;
}

/** What decides whether the list takes its order afresh: the set of goods, not their amounts. */
export function stockGoodsKey(rows: readonly StockBrowserRow[]): string {
  return rows
    .map((row) => row.goodType)
    .sort((x, y) => x - y)
    .join(',');
}

/** Whole units as integers, a banked fraction with one decimal. */
export function amountText(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

function fillOf(amount: number, capacity: number): string {
  return `${Math.round((Math.min(amount, capacity) / Math.max(1, capacity)) * 100)}%`;
}

/** The goods in the order a list takes afresh: in stock first, then empty, each group in the owner's
 *  order. */
export function stockFirst(rows: readonly StockBrowserRow[]): number[] {
  const stocked = rows.filter((row) => row.amount > 0);
  const empty = rows.filter((row) => row.amount <= 0);
  return [...stocked, ...empty].map((row) => row.goodType);
}

export function createStockBrowser(
  icons: GoodIconPainter,
  onAction: (goodType: number, event: MouseEvent) => void,
): StockBrowser {
  const root = element('div', 'on-stock');
  const list = element('ul', 'on-stock__list');
  const empty = element('p', 'on-stock__empty');
  root.append(list, empty);
  let goodsKey = '';
  let views = new Map<number, RowView>();

  const rowView = (row: StockBrowserRow): RowView => {
    const item = element('li', 'on-stock-row');
    const info = element(
      'span',
      'on-stock-row__info',
      `${goodIconMarkup(ROW_ICON_PX)}<span class="on-stock-row__name"></span><b class="on-stock-row__amount"></b><span class="on-meter on-meter--mini on-stock-row__meter"></span>`,
    );
    const frame = info.querySelector('.on-good__frame');
    if (row.goodId !== undefined && frame instanceof HTMLElement) icons(frame, row.goodId, ROW_ICON_PX);
    const [name, amount, meter] = [
      info.querySelector('.on-stock-row__name'),
      info.querySelector('.on-stock-row__amount'),
      info.querySelector('.on-stock-row__meter'),
    ];
    if (
      !(name instanceof HTMLElement) ||
      !(amount instanceof HTMLElement) ||
      !(meter instanceof HTMLElement)
    ) {
      throw new Error('stock browser: row');
    }
    const action = createRoundButton('ledger', (event) => onAction(row.goodType, event));
    item.append(info, action.element);
    return { item, info, name, amount, meter, action };
  };

  const rebuild = (rows: readonly StockBrowserRow[]): void => {
    const byGood = new Map(rows.map((row) => [row.goodType, row]));
    views = new Map();
    for (const goodType of stockFirst(rows)) {
      const row = byGood.get(goodType);
      if (row !== undefined) views.set(goodType, rowView(row));
    }
    list.replaceChildren(...[...views.values()].map((view) => view.item));
    list.scrollTop = 0;
  };

  return {
    element: root,
    update(model): void {
      setAttribute(list, 'aria-label', model.label);
      const key = stockGoodsKey(model.rows);
      if (key !== goodsKey) {
        goodsKey = key;
        rebuild(model.rows);
      }
      write(empty, model.rows.length === 0 ? model.empty : '');
      setClass(root, 'on-stock--empty', model.rows.length === 0);
      for (const row of model.rows) {
        const view = views.get(row.goodType);
        if (view === undefined) continue;
        write(view.name, row.label);
        write(view.amount, `${amountText(row.amount)} / ${row.capacity}`);
        const fill = fillOf(row.amount, row.capacity);
        if (view.meter.style.getPropertyValue('--value') !== fill)
          view.meter.style.setProperty('--value', fill);
        setClass(view.item, 'on-stock-row--out', row.amount <= 0);
        setClass(view.item, 'on-stock-row--lit', row.action?.pressed === true);
        setTip(view.info, row.tooltip);
        view.action.update(
          row.action === null
            ? null
            : {
                face: { glyph: row.action.glyph },
                label: row.action.label,
                tooltip: row.action.tooltip,
                enabled: row.action.enabled,
                pressed: row.action.pressed,
              },
        );
      }
    },
    reset(): void {
      goodsKey = '';
    },
  };
}
