import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  SettlerPanelModel,
  TradeCategoryModel,
  TradeDirection,
  TradeGoodModel,
  TradePanelModel,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import {
  button,
  element,
  onPress,
  setAttribute,
  setClass,
  setDisabled,
  setTip,
  write,
} from '../parts/dom.js';
import type { SettlerPanelDeps } from './actions.js';
import { createTradeDetail } from './trade-detail.js';
import {
  categoryDirection,
  categoryTargets,
  chipShortcut,
  directionAllowed,
  directionChanges,
  goodOf,
  routeHouses,
} from './trade-marks.js';

/** Good chips one row holds (foundation.css `.on-trade-chips` columns). */
export const TRADE_CHIPS_PER_ROW = 10;
/** Design px of a good's icon on a chip and on a tab face. */
const CHIP_ICON_PX = 18;
const TAB_ICON_PX = 18;

/** The corner mark of a marked chip: where the good goes. */
const DIRECTION_MARK: Readonly<Record<TradeDirection, string>> = {
  none: '',
  toA: 'A',
  toB: 'B',
  both: '⇄',
};

/** The chip rows the tallest category needs, reserved whatever tab is open so the tabs never move
 *  what follows them. */
export function reservedChipRows(categories: readonly TradeCategoryModel[]): number {
  let most = 0;
  for (const category of categories) most = Math.max(most, category.goods.length);
  return Math.max(1, Math.ceil(most / TRADE_CHIPS_PER_ROW));
}

/** The tab a fresh selection opens: the first category either house stores anything of. */
function firstStockedTab(categories: readonly TradeCategoryModel[]): number {
  return categories.find((category) => category.goods.length > 0)?.tab ?? 0;
}

function chipTooltip(good: TradeGoodModel): string {
  const copy = messages().hud.settlerPanel;
  const stock = formatMessage(copy.tradeChip, { good: good.label, stockA: good.stockA, stockB: good.stockB });
  const mark = DIRECTION_MARK[good.direction];
  const direction = good.direction === 'both' ? mark : mark === '' ? '' : `→ ${mark}`;
  return [stock, direction, copy.tradeChipShortcuts].filter((part) => part !== '').join(' · ');
}

interface TabView {
  readonly tab: HTMLButtonElement;
  readonly frame: HTMLElement;
  shownIcon: string;
}

interface ChipView {
  readonly goodType: number;
  readonly chip: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly mark: HTMLElement;
}

/** The goods of a two-stop own route: the category tabs, the open tab's good chips and the chosen
 *  good's detail. The open tab and the chosen good are the panel's own: they outlive the model the sim
 *  replaces every tick, and `reset` (another person) drops them. */
export interface TradeGoods {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
  reset(): void;
}

export function createTradeGoods(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): TradeGoods {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  let activeTab: number | null = null;
  let chosen: number | null = null;

  const root = element('div', 'on-trade-goods');
  const tabStrip = element('div', 'on-trade-tabs');
  tabStrip.setAttribute('role', 'tablist');
  const chips = element('div', 'on-trade-chips');
  const detail = createTradeDetail(deps, current, () => chosen);
  root.append(tabStrip, chips, detail.element);

  const repaint = (): void => {
    const trade = current()?.trade;
    if (trade != null) paint(trade);
  };
  const send = (trade: TradePanelModel, goods: readonly TradeGoodModel[], to: TradeDirection): void => {
    const houses = routeHouses(trade.stops);
    if (houses === null) return;
    const changes = goods
      .filter((good) => directionAllowed(good, to))
      .flatMap((good) => directionChanges(good, to, houses));
    if (changes.length > 0) actions.setTradeMarks(id(), changes);
  };
  const liveCategory = (tab: number): { trade: TradePanelModel; category: TradeCategoryModel } | null => {
    const trade = current()?.trade;
    const category = trade?.categories[tab];
    return trade == null || category === undefined ? null : { trade, category };
  };

  const tabs: TabView[] = messages().hud.stockTabs.map((_label, index) => {
    const tab = button('on-trade-tab', `${goodIconMarkup(TAB_ICON_PX)}<i class="on-trade-tab__dot"></i>`);
    tab.setAttribute('role', 'tab');
    const frame = tab.querySelector('.on-good__frame');
    if (!(frame instanceof HTMLElement)) throw new Error('trade: tab face');
    onPress(tab, (event) => {
      const live = liveCategory(index);
      if (live === null || live.category.goods.length === 0) return;
      activeTab = index;
      if (event.ctrlKey || event.metaKey) {
        send(live.trade, categoryTargets(live.category), categoryDirection(live.category));
      }
      repaint();
    });
    tabStrip.append(tab);
    return { tab, frame, shownIcon: '' };
  });

  const chipView = (goodType: number, goodId: string | undefined): ChipView => {
    const chip = button(
      'on-chip',
      `${goodIconMarkup(CHIP_ICON_PX)}<b class="on-chip__count"></b><i class="on-chip__mark"></i>`,
    );
    const frame = chip.querySelector('.on-good__frame');
    const count = chip.querySelector('.on-chip__count');
    const mark = chip.querySelector('.on-chip__mark');
    if (!(count instanceof HTMLElement) || !(mark instanceof HTMLElement)) throw new Error('trade: chip');
    if (goodId !== undefined && frame instanceof HTMLElement) deps.icons(frame, goodId, CHIP_ICON_PX);
    onPress(chip, (event) => {
      chosen = goodType;
      const trade = current()?.trade;
      const good = trade == null ? undefined : goodOf(trade, goodType);
      if (trade != null && good !== undefined) {
        const target = chipShortcut(good.direction, {
          ctrl: event.ctrlKey || event.metaKey,
          shift: event.shiftKey,
        });
        if (target !== null) send(trade, [good], target);
      }
      repaint();
    });
    return { goodType, chip, count, mark };
  };

  let shownChips = '';
  let chipViews: ChipView[] = [];

  const paint = (trade: TradePanelModel): void => {
    const copy = messages().hud.settlerPanel;
    const kept = activeTab === null ? undefined : trade.categories[activeTab];
    const open = kept !== undefined && kept.goods.length > 0 ? kept.tab : firstStockedTab(trade.categories);
    activeTab = open;
    tabs.forEach((view, index) => {
      const category = trade.categories[index];
      const goods = category?.goods ?? [];
      const face = goods[0]?.goodId ?? '';
      if (face !== view.shownIcon) {
        view.shownIcon = face;
        if (face === '') view.frame.removeAttribute('style');
        else deps.icons(view.frame, face, TAB_ICON_PX);
      }
      const label = category?.label ?? '';
      setAttribute(view.tab, 'aria-label', label);
      setAttribute(view.tab, 'aria-selected', String(index === open));
      setDisabled(view.tab, goods.length === 0);
      setClass(
        view.tab,
        'on-trade-tab--marked',
        goods.some((good) => good.direction !== 'none'),
      );
      const allToB = category !== undefined && categoryDirection(category) === 'none';
      setTip(
        view.tab,
        goods.length === 0
          ? formatMessage(copy.tradeTabEmpty, { category: label })
          : formatMessage(allToB ? copy.tradeTabClearAll : copy.tradeTabMarkAll, { category: label }),
      );
    });
    const goods = trade.categories[open]?.goods ?? [];
    const key = goods.map((good) => good.goodType).join(',');
    if (key !== shownChips) {
      shownChips = key;
      chipViews = goods.map((good) => chipView(good.goodType, good.goodId));
      chips.replaceChildren(...chipViews.map((view) => view.chip));
    }
    chips.style.setProperty('--rows', String(reservedChipRows(trade.categories)));
    // Nothing chosen yet, or the chosen good left the route: the open tab's first stocked good, so the
    // detail never stands empty.
    const chosenGood =
      goodOf(trade, chosen) ?? goods.find((good) => good.stockA + good.stockB > 0) ?? goods[0];
    chosen = chosenGood?.goodType ?? null;
    goods.forEach((good, index) => {
      const view = chipViews[index];
      if (view === undefined) return;
      const stocked = good.stockA + good.stockB;
      write(view.count, String(stocked));
      write(view.mark, DIRECTION_MARK[good.direction]);
      setAttribute(view.chip, 'aria-label', good.label);
      setAttribute(view.chip, 'aria-pressed', String(good.goodType === chosen));
      setClass(view.chip, 'on-chip--empty', stocked === 0);
      setClass(view.chip, 'on-chip--one-way', good.direction === 'toA' || good.direction === 'toB');
      setClass(view.chip, 'on-chip--both', good.direction === 'both');
      setTip(view.chip, chipTooltip(good));
    });
    detail.update(trade, chosenGood ?? null);
  };

  return {
    element: root,
    update: paint,
    reset(): void {
      activeTab = null;
      chosen = null;
    },
  };
}
