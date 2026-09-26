import { formatMessage, messages } from '../../../i18n/index.js';
import { TRADE_SLOT_A, type TradePanelModel } from '../../details-panel/model/index.js';
import { stockTabLabels } from '../../good-categories.js';
import type { BuildingHoverModel } from '../../hover-card/model.js';
import type { GoodIconPainter } from '../good-art.js';
import type { HoverCard } from '../hover-card.js';
import { GLYPH, STOCK_TAB_GLYPHS } from '../icons.js';
import { button, element, setAttribute, setClass, setTip, write } from '../parts/dom.js';
import { createStockBrowser } from '../parts/stock-browser.js';
import { houseRows } from './model.js';
import { stopBadge } from './route.js';

export interface HouseColumnDeps {
  readonly icons: GoodIconPainter;
  readonly hoverCard: HoverCard;
  readonly buildingHover: (id: number) => BuildingHoverModel | null;
  /** The house link: select the house and bring it into view. */
  readonly show: (house: number) => void;
  /** The portrait: bring the house into view, keeping the trader's selection. */
  readonly centre: (house: number) => void;
  /** A row's arrow was pressed, with Ctrl (or ⌘) held or not. */
  readonly onArrow: (slot: number, goodType: number, ctrl: boolean) => void;
}

/** One house of the route: a head of its live portrait, badge, name link, heading arrow and category
 *  tabs, over its stock of the open tab with an arrow per good that carries it into the other house.
 *  B mirrors A, so the portraits sit at the outer edges and the arrows flank the middle. */
export interface HouseColumn {
  readonly element: HTMLElement;
  /** The frame the renderer paints the house's live cutout into (its padding box). */
  readonly portrait: HTMLElement;
  /** The house shown, or null before the first paint. */
  house(): number | null;
  update(trade: TradePanelModel): void;
  /** A reopened window: the list takes its order and scroll afresh, the open tab stays. */
  reorder(): void;
  /** A new trader: the open tab is chosen afresh too. */
  reset(): void;
  /** Focus the open category tab. */
  focusTabs(): void;
}

export function createHouseColumn(deps: HouseColumnDeps, slot: number): HouseColumn {
  const left = slot === TRADE_SLOT_A;
  const root = element('section', left ? 'on-trade-house' : 'on-trade-house on-trade-house--mirrored');
  const head = element('div', 'on-trade-house__head');
  const portrait = button('on-portrait__frame on-trade-house__portrait');
  const beside = element('div', 'on-trade-house__beside');
  const title = element('div', 'on-trade-house__title');
  const badge = element('span', 'on-stop__badge', stopBadge(slot));
  const link = button('on-ledger__link on-trade-house__name');
  const heading = element('span', 'on-trade-house__heading', GLYPH.arrow);
  title.append(badge, link, heading);
  const browser = createStockBrowser(
    deps.icons,
    (goodType, event) => deps.onArrow(slot, goodType, event.ctrlKey || event.metaKey),
    {
      tabs: { glyphs: STOCK_TAB_GLYPHS, groupLabel: messages().hud.tradeWindow.tabs, labels: stockTabLabels },
      actionSide: left ? 'end' : 'start',
    },
  );
  const tabs = browser.tabs;
  if (tabs === null) throw new Error('trade house: tabs');
  beside.append(title, tabs);
  head.append(portrait, beside);
  const sheet = element('div', 'on-parchment on-trade-house__stock');
  sheet.append(browser.element);
  root.append(head, sheet);
  let house: number | null = null;

  link.addEventListener('click', () => {
    if (house !== null) deps.show(house);
  });
  portrait.addEventListener('click', () => {
    if (house !== null) deps.centre(house);
  });
  const hover = (event: MouseEvent | null): void => {
    const card = event === null || house === null ? null : deps.buildingHover(house);
    if (card === null || event === null) deps.hoverCard.hide();
    else deps.hoverCard.show(event.clientX, event.clientY, card);
  };
  link.addEventListener('mouseenter', hover);
  link.addEventListener('mousemove', hover);
  link.addEventListener('mouseleave', () => hover(null));

  return {
    element: root,
    portrait,
    house: () => house,
    update(trade): void {
      const copy = messages().hud.tradeWindow;
      const stop = trade.stops.find((candidate) => candidate.slot === slot);
      // Another house under the link takes its card with it: a relabelled link reports no leave.
      if (stop?.house !== house) deps.hoverCard.hide();
      house = stop?.house ?? null;
      const badgeText = stopBadge(slot);
      write(link, stop?.label ?? '');
      const centreTip = formatMessage(copy.portraitTooltip, { house: stop?.label ?? badgeText });
      setTip(portrait, centreTip);
      setAttribute(portrait, 'aria-label', centreTip);
      setClass(root, 'on-trade-house--heading', stop?.heading === true);
      setTip(heading, messages().hud.settlerPanel.tradeHeading);
      browser.update({
        label: formatMessage(copy.stockLabel, { badge: badgeText }),
        rows: houseRows(trade, slot),
        empty: copy.stockEmpty,
      });
    },
    reorder: () => browser.reorder(),
    reset: () => browser.reset(),
    focusTabs(): void {
      tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    },
  };
}
