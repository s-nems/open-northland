import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel, StockRow } from '../../details-panel/model/index.js';
import { stockTabLabels } from '../../good-categories.js';
import { STOCK_TAB_GLYPHS } from '../icons.js';
import { stockAmount } from '../parts/amount.js';
import { createCategoryTabs } from '../parts/category-tabs.js';
import { element, removeAttribute, setAttribute, setClass, setHidden } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import { keptRanking, OVERVIEW_TAB, stockStripGlyphs, stockTabRows } from '../parts/stock-browser.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** Design px of one stock line (foundation.css `.on-cargo-row`), and the lines a list squeezed to fit
 *  the plane still shows. */
const STOCK_LINE_PX = 25;
const STOCK_LINES_LEAST = 3;

/** Magazyn: every good the house stores, what it holds against its shelf with the shelf's fill on the
 *  rule, empty shelves faded, an input the workers wait for in amber and a product's full shelf in red.
 *  A store opens on its largest stocks and lists the rest by category under icon tabs; a workshop's
 *  inputs stand under "Zużywa" and its products under "Wytwarza". Past eight lines the list scrolls in place. */
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
  const tabs = createCategoryTabs(
    stockStripGlyphs(STOCK_TAB_GLYPHS),
    messages().hud.buildingPanel.stockTabs,
    (index) => {
      tab = index;
      if (shown !== null) paint(shown);
    },
  );
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
  // The overview's ranking, kept while the same goods lead so no line moves under the cursor.
  let ranked: readonly StockRow[] = [];

  const overview = (stock: readonly StockRow[]): StockRow[] => {
    ranked = keptRanking(ranked, stockTabRows(stock, OVERVIEW_TAB));
    return [...ranked];
  };

  const paint = (model: BuildingPanelModel): void => {
    const copy = messages().hud.buildingPanel;
    const tabbed = model.stockLayout === 'tabs';
    setHidden(tabs.element, !tabbed);
    if (tabbed) {
      const labels = stockTabLabels();
      tabs.update(
        [
          {
            label: messages().hud.stockOverview,
            empty: !model.stock.some((row) => row.amount > 0),
            marked: false,
          },
          ...labels.map((label, index) => ({
            label,
            empty: !model.stock.some((row) => row.category === index),
            marked: model.stock.some((row) => row.category === index && row.amount > 0),
          })),
        ],
        tab,
      );
    }
    const rows = !tabbed
      ? model.stock
      : tab === OVERVIEW_TAB
        ? overview(model.stock)
        : stockTabRows(model.stock, tab);
    setHidden(empty, rows.length > 0);
    empty.textContent = tabbed && tab === OVERVIEW_TAB ? messages().hud.stockOverviewEmpty : copy.stockEmpty;
    // The overview has its own order, so another tab is another list even over the same goods.
    const kept = syncLines(
      list,
      lines,
      rows.map((row) => `${tab}:${row.goodType}`),
      () => createGoodLine(deps.icons),
    );
    const split = model.stockLayout === 'split';
    rows.forEach((row, index) => {
      const line = kept[index];
      if (line === undefined) return;
      const product = row.product === true;
      const runStarts = index === 0 || (rows[index - 1]?.product === true) !== product;
      const caption = !split || !runStarts ? null : product ? copy.stockMakes : copy.stockUses;
      setClass(line.element, 'on-cargo-row--caption', caption !== null);
      if (caption === null) removeAttribute(line.element, 'data-caption');
      else setAttribute(line.element, 'data-caption', caption);
      const capacity = row.capacity ?? 0;
      const words = formatMessage(copy.stockRow, {
        good: row.label,
        amount: stockAmount(row.amount),
        capacity: stockAmount(capacity),
      });
      line.update({
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
        tab = OVERVIEW_TAB;
        ranked = [];
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
