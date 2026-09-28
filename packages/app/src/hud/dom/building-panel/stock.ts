import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel, StockRow } from '../../details-panel/model/index.js';
import { stockTabLabels } from '../../good-categories.js';
import { STOCK_TAB_GLYPHS } from '../icons.js';
import { stockAmount } from '../parts/amount.js';
import { createCategoryTabs } from '../parts/category-tabs.js';
import { element, setClass, setHidden } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** A house storing more goods than this lists them by category under the stock tabs. */
export const STOCK_TABS_FROM = 9;
/** Design px of one stock line (foundation.css `.on-cargo-row`), and the lines a list squeezed to fit
 *  the plane still shows. */
const STOCK_LINE_PX = 25;
const STOCK_LINES_LEAST = 3;

/** The category a house's stock opens on: the first that holds anything, else the first it stores. */
export function openingStockTab(rows: readonly StockRow[], tabs: number): number {
  for (let tab = 0; tab < tabs; tab++) {
    if (rows.some((row) => row.category === tab && row.amount > 0)) return tab;
  }
  for (let tab = 0; tab < tabs; tab++) if (rows.some((row) => row.category === tab)) return tab;
  return 0;
}

/** Magazyn: every good the house stores in its slot order, what it holds against its shelf with the
 *  shelf's fill on the rule, empty shelves faded, an input the workers wait for in amber and a product's
 *  full shelf in red. A large store lists one category at a time under icon tabs; past eight lines the
 *  list scrolls in place. */
export interface StockSection {
  readonly element: HTMLElement;
  /** `fresh` is another house: the tab opens anew. */
  update(model: BuildingPanelModel, fresh: boolean): void;
  /** Shorten the list by `overflow` design px, down to a few lines; it scrolls in place. */
  fit(overflow: number): void;
  unfit(): void;
}

export function createStockSection(deps: BuildingPanelDeps): StockSection {
  const title = createSection();
  let tab = 0;
  let shown: BuildingPanelModel | null = null;
  const tabs = createCategoryTabs(STOCK_TAB_GLYPHS, messages().hud.buildingPanel.stockTabs, (index) => {
    tab = index;
    if (shown !== null) paint(shown);
  });
  const list = element('ul', 'on-manifest on-manifest--lines');
  const empty = element('p', 'on-building-empty on-ledger--muted');
  const paintFold = (): void => {
    const below = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
    setClass(list, 'on-manifest--more', below);
  };
  list.addEventListener('scroll', paintFold, { passive: true });
  const root = element('div', 'on-building-stock');
  root.append(title.element, tabs.element, list, empty);
  const lines = new Map<string, GoodLine>();

  const paint = (model: BuildingPanelModel): void => {
    const copy = messages().hud.buildingPanel;
    const tabbed = model.stock.length >= STOCK_TABS_FROM;
    setHidden(tabs.element, !tabbed);
    if (tabbed) {
      tabs.update(
        stockTabLabels().map((label, index) => ({
          label,
          empty: !model.stock.some((row) => row.category === index),
          marked: model.stock.some((row) => row.category === index && row.amount > 0),
        })),
        tab,
      );
    }
    const rows = tabbed ? model.stock.filter((row) => row.category === tab) : model.stock;
    setHidden(empty, rows.length > 0);
    empty.textContent = copy.stockEmpty;
    const kept = syncLines(
      list,
      lines,
      rows.map((row) => `${row.goodType}`),
      () => createGoodLine(deps.icons),
    );
    rows.forEach((row, index) => {
      const capacity = row.capacity ?? 0;
      const words = formatMessage(copy.stockRow, {
        good: row.label,
        amount: stockAmount(row.amount),
        capacity: stockAmount(capacity),
      });
      kept[index]?.update({
        goodId: row.goodId,
        label: row.label,
        value: stockAmount(row.amount, row.capacity),
        fill: meterFill(row.amount, capacity),
        tooltip:
          row.alert === undefined
            ? words
            : formatMessage(row.alert === 'waiting' ? copy.stockWaiting : copy.stockFull, {
                good: row.label,
              }),
        muted: row.amount <= 0 && row.alert === undefined,
        ...(row.alert === undefined ? {} : { tone: row.alert === 'waiting' ? 'warning' : 'danger' }),
      });
    });
    paintFold();
  };

  return {
    element: root,
    update(model, fresh): void {
      shown = model;
      setHidden(root, model.stock.length === 0);
      if (model.stock.length === 0) return;
      title.update(messages().hud.buildingPanel.stock);
      if (fresh) {
        tab = openingStockTab(model.stock, STOCK_TAB_GLYPHS.length);
        list.scrollTop = 0;
      }
      paint(model);
    },
    fit(overflow): void {
      const least = STOCK_LINES_LEAST * STOCK_LINE_PX;
      list.style.maxHeight = `${Math.max(least, list.clientHeight - overflow)}px`;
      paintFold();
    },
    unfit(): void {
      list.style.removeProperty('max-height');
    },
  };
}
