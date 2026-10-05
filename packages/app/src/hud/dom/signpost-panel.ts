import { formatMessage, messages } from '../../i18n/index.js';
import type { SignpostPanelModel, UnitPanelModel } from '../details-panel/model/index.js';
import type { NetworkStockRow } from '../details-panel/model/signpost.js';
import { stockTabLabels } from '../good-categories.js';
import { createGoodLine, type GoodLine, syncLines } from './building-panel/good-line.js';
import type { GoodIconPainter } from './good-art.js';
import { GLYPH, STOCK_TAB_GLYPHS } from './icons.js';
import { stockAmount } from './parts/amount.js';
import { createCategoryTabs } from './parts/category-tabs.js';
import { element, setHidden, setTip, write } from './parts/dom.js';
import { createSection } from './parts/section.js';
import { keptRanking, stockStripGlyphs, stockTabRows } from './parts/stock-browser.js';
import type { TipChip } from './parts/tip-layer.js';
import { createSelectionPanel } from './selection-panel.js';

interface SignpostPanelDeps {
  readonly plane: HTMLElement;
  readonly icons: GoodIconPainter;
  readonly tooltip: TipChip;
  readonly close: () => void;
  readonly demolish: (entityId: number) => void;
}

export function createSignpostPanel(deps: SignpostPanelDeps) {
  let shown: SignpostPanelModel | null = null;
  let tab = 0;
  let ranked: readonly NetworkStockRow[] = [];
  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: () => {},
      onOrders: () => {},
      onKickerDoubleClick: () => {},
      onRename: () => {},
      onClose: deps.close,
    },
    deps.tooltip,
  );
  frame.element.classList.add('on-signpost');
  const stock = element('div', 'on-signpost-stock');
  const title = createSection();
  const list = element('ul', 'on-manifest on-manifest--lines');
  const empty = element('p', 'on-signpost-empty');
  const shelves = element('div', 'on-signpost-shelves');
  shelves.append(list, empty);
  const tabs = createCategoryTabs(
    stockStripGlyphs(STOCK_TAB_GLYPHS),
    messages().hud.buildingPanel.stockTabs,
    (index) => {
      tab = index;
      list.scrollTop = 0;
      paint();
    },
  );
  stock.append(title.element, tabs.element, shelves);
  const actions = element('div', 'on-signpost-actions');
  const demolish = element('button', 'on-order on-order--tile on-order--attack');
  demolish.type = 'button';
  const label = element('span', '');
  demolish.innerHTML = GLYPH.demolish;
  demolish.append(label);
  demolish.addEventListener('click', () => {
    if (shown?.canDemolish) deps.demolish(shown.entityId);
  });
  actions.append(demolish);
  frame.body.append(stock, actions);
  const lines = new Map<string, GoodLine>();

  const fit = (): void => {
    shelves.style.removeProperty('height');
    const overflow = frame.overflow();
    if (overflow > 0) shelves.style.height = `${Math.max(75, shelves.clientHeight - overflow)}px`;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(deps.plane);

  function paint(): void {
    if (shown === null) return;
    const copy = messages().hud.signpostPanel;
    title.update(copy.stock);
    write(empty, copy.empty);
    write(label, copy.demolish);
    setTip(demolish, messages().hud.demolishSignpost);
    demolish.disabled = !shown.canDemolish;
    frame.updateHead({
      kicker: '',
      browse: null,
      title: messages().hud.signpost,
      rename: null,
      meta: formatMessage(copy.count, { count: shown.postCount }),
      orders: null,
      labels: messages().hud.settlerPanel,
    });
    const stock = shown.stock;
    tabs.update(
      [
        { label: messages().hud.stockOverview, empty: stock.length === 0, marked: false },
        ...stockTabLabels().map((label, index) => ({
          label,
          empty: !stock.some((row) => row.category === index),
          marked: stock.some((row) => row.category === index),
        })),
      ],
      tab,
    );
    const filtered = stockTabRows(stock, tab);
    if (tab === 0) ranked = keptRanking(ranked, filtered);
    const rows = tab === 0 ? ranked : filtered;
    setHidden(list, rows.length === 0);
    setHidden(empty, rows.length > 0);
    const kept = syncLines(
      list,
      lines,
      rows.map((row) => `${tab}:${row.goodType}`),
      () => createGoodLine(deps.icons),
    );
    rows.forEach((row, i) => {
      kept[i]?.update({
        goodId: row.goodId,
        label: row.label,
        value: stockAmount(row.amount),
        fill: '0%',
        tooltip: row.label,
      });
    });
    frame.show();
    fit();
  }

  return {
    update(model: UnitPanelModel): void {
      if (model.kind !== 'signpost') {
        shown = null;
        frame.hide();
        return;
      }
      if (shown?.entityId !== model.entityId) {
        tab = 0;
        ranked = [];
        list.scrollTop = 0;
      }
      shown = model;
      paint();
    },
    claims: frame.claims,
    refresh: frame.refreshTip,
    invalidate(): void {
      frame.invalidate();
      fit();
    },
    dispose(): void {
      resize.disconnect();
      frame.dispose();
    },
  };
}
