import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { amountText } from './amount.js';
import { type CategoryTab, createCategoryTabs } from './category-tabs.js';
import { element, setAttribute, setClass, setStyleVar, setTip, write } from './dom.js';
import { meterFill } from './meter-row.js';
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
  /** The stock category tab the row is listed under, while the browser has its tab strip. */
  readonly category: number;
  /** Lights its category's tab dot (the trade window: the good is in a transfer). */
  readonly marked: boolean;
  readonly amount: number;
  readonly capacity: number;
  /** The tooltip over the good's name and numbers; empty for none. */
  readonly tooltip: string;
  readonly action: StockRowAction | null;
}

export interface StockBrowserModel {
  /** The accessible name of the list. */
  readonly label: string;
  /** Every good the house stores; with the tab strip, the open tab's are listed. */
  readonly rows: readonly StockBrowserRow[];
  /** The line shown while there are no rows. */
  readonly empty: string;
}

/** The optional category strip: one icon tab per stock category, each browser keeping its own. */
export interface StockBrowserTabs {
  /** One face per category, in tab order. */
  readonly glyphs: readonly string[];
  readonly groupLabel: string;
  /** The categories' names in tab order, read at each paint for the current language. */
  readonly labels: () => readonly string[];
}

/**
 * A house's stock as a list: per good the icon, the name, "amount / shelf" and a thin meter, and an
 * optional button the owner defines. It knows nothing of what the button means: the trade window
 * uses it for its two houses, and the building window is meant to reuse it for a house's stock.
 *
 * With the optional tab strip the browser lists the open category's goods and keeps that tab itself,
 * opening on the first category that holds anything. Goods in stock lead and the empty ones follow
 * faded, in the owner's order within each group. That order is taken when the listed goods change
 * (another tab, another house) or on `reorder`, and kept while only amounts change, so a row never
 * moves under the cursor as the sim ticks. The list scrolls inside itself; the owner sizes it.
 */
export interface StockBrowser {
  /** The list. */
  readonly element: HTMLElement;
  /** The category strip, placed by the owner (beside a portrait, over the list); null without one. */
  readonly tabs: HTMLElement | null;
  update(model: StockBrowserModel): void;
  /** The open category, or null without a strip. */
  activeTab(): number | null;
  /** Take the order and the scroll afresh (a reopened window). */
  reorder(): void;
  /** Another subject: the order, the scroll and the open tab are taken afresh. */
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

/** The goods in the order a list takes afresh: in stock first, then empty, each group in the owner's
 *  order. */
export function stockFirst(rows: readonly StockBrowserRow[]): number[] {
  const stocked = rows.filter((row) => row.amount > 0);
  const empty = rows.filter((row) => row.amount <= 0);
  return [...stocked, ...empty].map((row) => row.goodType);
}

/** The kinds in stock and whether a marked good sits in each category. */
export function stockTabStates(
  rows: readonly StockBrowserRow[],
  categories: number,
): { readonly stocked: number; readonly marked: boolean }[] {
  const states = Array.from({ length: categories }, () => ({ stocked: 0, marked: false }));
  for (const row of rows) {
    const state = states[row.category];
    if (state === undefined) continue;
    if (row.amount > 0) state.stocked++;
    if (row.marked) state.marked = true;
  }
  return states;
}

/** The tab a fresh browser opens on: the first category holding anything, else the first. */
export function firstStockedTab(states: readonly { readonly stocked: number }[]): number {
  const found = states.findIndex((state) => state.stocked > 0);
  return found < 0 ? 0 : found;
}

/** Where a row's button sits: after the numbers, or before the icon (the right-hand list of a pair,
 *  so both lists' buttons flank the line between them). */
export type StockActionSide = 'start' | 'end';

export interface StockBrowserOptions {
  readonly tabs?: StockBrowserTabs;
  readonly actionSide?: StockActionSide;
}

export function createStockBrowser(
  icons: GoodIconPainter,
  onAction: (goodType: number, event: MouseEvent) => void,
  options: StockBrowserOptions = {},
): StockBrowser {
  const tabsOptions = options.tabs;
  const leading = options.actionSide === 'start';
  const root = element('div', leading ? 'on-stock on-stock--lead' : 'on-stock');
  const list = element('ul', 'on-stock__list');
  const empty = element('p', 'on-stock__empty');
  root.append(list, empty);
  let goodsKey = '';
  let views = new Map<number, RowView>();
  let active: number | null = null;
  let last: StockBrowserModel | null = null;
  const strip =
    tabsOptions === undefined
      ? null
      : createCategoryTabs(tabsOptions.glyphs, tabsOptions.groupLabel, (index) => {
          active = index;
          if (last !== null) paint(last);
        });

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
    if (leading) item.append(action.element, info);
    else item.append(info, action.element);
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

  const paintTabs = (rows: readonly StockBrowserRow[]): number | null => {
    if (strip === null || tabsOptions === undefined) return null;
    const states = stockTabStates(rows, tabsOptions.glyphs.length);
    const open = active ?? firstStockedTab(states);
    active = open;
    const labels = tabsOptions.labels();
    const tabs: CategoryTab[] = states.map((state, category) => ({
      label: labels[category] ?? '',
      empty: state.stocked === 0,
      marked: state.marked,
    }));
    strip.update(tabs, open);
    return open;
  };

  const paint = (model: StockBrowserModel): void => {
    last = model;
    setAttribute(list, 'aria-label', model.label);
    const open = paintTabs(model.rows);
    const rows = open === null ? model.rows : model.rows.filter((row) => row.category === open);
    const key = stockGoodsKey(rows);
    if (key !== goodsKey) {
      goodsKey = key;
      rebuild(rows);
    }
    write(empty, rows.length === 0 ? model.empty : '');
    setClass(root, 'on-stock--empty', rows.length === 0);
    for (const row of rows) {
      const view = views.get(row.goodType);
      if (view === undefined) continue;
      write(view.name, row.label);
      write(view.amount, `${amountText(row.amount)} / ${row.capacity}`);
      setStyleVar(view.meter, '--value', meterFill(row.amount, row.capacity));
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
  };

  return {
    element: root,
    tabs: strip?.element ?? null,
    update: paint,
    activeTab: () => active,
    reorder(): void {
      goodsKey = '';
    },
    reset(): void {
      goodsKey = '';
      active = null;
    },
  };
}
