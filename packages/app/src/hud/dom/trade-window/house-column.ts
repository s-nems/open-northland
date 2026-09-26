import { formatMessage, messages } from '../../../i18n/index.js';
import type { TradePanelModel } from '../../details-panel/model/index.js';
import type { BuildingHoverModel } from '../../hover-card/model.js';
import type { GoodIconPainter } from '../good-art.js';
import type { HoverCard } from '../hover-card.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setTip, write } from '../parts/dom.js';
import { createStockBrowser } from '../parts/stock-browser.js';
import { houseRows } from './model.js';
import { stopBadge } from './route.js';

export interface HouseColumnDeps {
  readonly icons: GoodIconPainter;
  readonly hoverCard: HoverCard;
  readonly buildingHover: (id: number) => BuildingHoverModel | null;
  /** The house link: select the house and bring it into view. */
  readonly show: (house: number) => void;
  /** A row's arrow was pressed, with Ctrl (or ⌘) held or not. */
  readonly onArrow: (slot: number, goodType: number, ctrl: boolean) => void;
}

/** One house of the route: its badge, its name as a link with the hover card, the heading arrow,
 *  and its stock of the open category with an arrow per good that carries it into the other house. */
export interface HouseColumn {
  readonly element: HTMLElement;
  update(trade: TradePanelModel, category: number): void;
  /** A new trader: the stock list takes its order and scroll afresh. */
  reset(): void;
}

export function createHouseColumn(deps: HouseColumnDeps, slot: number): HouseColumn {
  const root = element('section', 'on-trade-house');
  const head = element('div', 'on-trade-house__head');
  const badge = element('span', 'on-stop__badge', stopBadge(slot));
  const link = button('on-ledger__link on-trade-house__name');
  const heading = element('span', 'on-trade-house__heading', GLYPH.arrow);
  head.append(badge, link, heading);
  const browser = createStockBrowser(deps.icons, (goodType, event) =>
    deps.onArrow(slot, goodType, event.ctrlKey || event.metaKey),
  );
  root.append(head, browser.element);
  let house: number | null = null;

  link.addEventListener('click', () => {
    if (house !== null) deps.show(house);
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
    update(trade, category): void {
      const copy = messages().hud;
      const stop = trade.stops.find((candidate) => candidate.slot === slot);
      // Another house under the link takes its card with it: a relabelled link reports no leave.
      if (stop?.house !== house) deps.hoverCard.hide();
      house = stop?.house ?? null;
      write(link, stop?.label ?? '');
      setTip(link, formatMessage(copy.tradeWindow.stopTooltip, { badge: stopBadge(slot) }));
      setClass(root, 'on-trade-house--heading', stop?.heading === true);
      setTip(heading, copy.settlerPanel.tradeHeading);
      browser.update({
        label: formatMessage(copy.tradeWindow.stockLabel, { badge: stopBadge(slot) }),
        rows: houseRows(trade, slot, category),
        empty: copy.tradeWindow.stockEmpty,
      });
    },
    reset: () => browser.reset(),
  };
}
