import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type SettlerPanelModel,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradePanelModel,
} from '../../details-panel/model/index.js';
import type { BuildingHoverModel } from '../../hover-card/model.js';
import type { GoodIconPainter } from '../good-art.js';
import type { HoverCard } from '../hover-card.js';
import { createCategoryTabs } from '../parts/category-tabs.js';
import { element, write } from '../parts/dom.js';
import { attachTipLayer, type TipChip } from '../parts/tip-layer.js';
import type { SettlerPanelActions } from '../settler-panel/actions.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import { createTradeCommands } from './commands.js';
import { createHouseColumn } from './house-column.js';
import { categoryTabs, firstStockedTab, windowRoute } from './model.js';
import { createTransfersList } from './transfers.js';

/** Design px (FOUNDATION.md, "Okno handlu"): two stock lists side by side, and on the 1365 px plane
 *  of a 1280 × 720 screen the centred window still clears the 318 px settler panel. */
const TRADE_WINDOW_W = 720;
/** The window painted out of sight for its warm-up frame, and stepped aside for the action ring. */
const WARM_CLASS = 'on-window--warm';
const VEIL_CLASS = 'on-window--veiled';

/** The tool panel's central windows (construction, residents, ...), which the trade window shares the
 *  centre of the screen with: one central window at a time. */
export interface CentralWindows {
  isOpen(): boolean;
  close(): void;
}

export interface TradeWindowDeps {
  readonly plane: HTMLElement;
  readonly icons: GoodIconPainter;
  readonly tooltip: TipChip;
  readonly hoverCard: HoverCard;
  readonly buildingHover: (id: number) => BuildingHoverModel | null;
  readonly actions: Pick<SettlerPanelActions, 'show' | 'setTradeMarks' | 'setTradeImportLimits'>;
  readonly centralWindows?: CentralWindows;
}

/**
 * The trade between a trader's two own houses, in the centre of the screen (FOUNDATION.md, "Okno
 * handlu"): one category tab strip over both houses' stock, an arrow per good that sets up a
 * transfer into the other house, and the transfers with their direction and limits. It belongs to
 * the selected trader: another selection, a route without two own stops or a beam window opened
 * after it closes it.
 */
export interface TradeWindow {
  isOpen(): boolean;
  /** Open for the settler the model shows, when its route is two own houses. */
  open(model: SettlerPanelModel): void;
  /** Close as the cross does, telling the dismiss listeners. */
  dismiss(): void;
  close(): void;
  /** The shown settler's model; closes the window when it no longer fits. */
  update(model: SettlerPanelModel): void;
  /** Once a frame: re-place on a new plane size and yield to a beam window opened after it. */
  refresh(): void;
  onDismiss(listener: () => void): void;
  claims(clientX: number, clientY: number): boolean;
  veil(on: boolean): void;
  /** Paint once out of sight at map start, so the first open costs no first-paint work. */
  warm(model: SettlerPanelModel): void;
  dispose(): void;
}

export function createTradeWindow(deps: TradeWindowDeps): TradeWindow {
  const copy = messages().hud;
  const window = createHudWindow(deps.plane, {
    title: copy.trade,
    closeLabel: copy.shell.close,
    width: TRADE_WINDOW_W,
    compact: true,
  });
  window.element.classList.add('on-window--trade');
  window.body.classList.add('on-window__body--column');
  const title = window.element.querySelector('.on-window__title');
  const placeWindow = centralWindowPlacer(window, deps.plane, TRADE_WINDOW_W);
  const tips = attachTipLayer(window.element, deps.tooltip);

  /** The trader the window is open for, and its model as last painted. */
  let trader: number | null = null;
  let shown: TradePanelModel | null = null;
  let tab: number | null = null;

  const commands = createTradeCommands(deps.actions, () =>
    trader === null || shown === null ? null : { trader, trade: shown },
  );

  const tabs = createCategoryTabs(copy.tradeWindow.tabs, (index) => {
    tab = index;
    if (shown !== null) paint(shown);
  });
  const columnDeps = {
    icons: deps.icons,
    hoverCard: deps.hoverCard,
    buildingHover: deps.buildingHover,
    show: (house: number) => deps.actions.show(house),
    onArrow: commands.arrow,
  };
  const houseA = createHouseColumn(columnDeps, TRADE_SLOT_A);
  const houseB = createHouseColumn(columnDeps, TRADE_SLOT_B);
  const houses = element('div', 'on-parchment on-trade-houses');
  houses.append(houseA.element, houseB.element);
  const transfersTitle = element('div', 'on-section on-trade-transfers__title', '<span></span>');
  const transfers = createTransfersList({
    icons: deps.icons,
    setFlow: commands.setFlow,
    setLimits: commands.setLimits,
  });
  const lower = element('div', 'on-trade-transfers');
  lower.append(transfersTitle, transfers.element);
  window.body.append(tabs.element, houses, lower);

  const paint = (trade: TradePanelModel): void => {
    shown = trade;
    const open = tab ?? firstStockedTab(trade);
    tab = open;
    tabs.update(categoryTabs(trade), open);
    houseA.update(trade, open);
    houseB.update(trade, open);
    const heading = transfersTitle.firstElementChild;
    if (heading !== null) {
      const count = trade.transfers.length;
      write(heading, count > 0 ? `${copy.tradeWindow.transfers} · ${count}` : copy.tradeWindow.transfers);
    }
    transfers.update(trade);
  };

  const close = (): void => {
    tips.hide();
    deps.hoverCard.hide();
    window.close();
  };
  window.onDismiss(() => {
    tips.hide();
    deps.hoverCard.hide();
  });

  const show = (model: SettlerPanelModel, trade: TradePanelModel): void => {
    if (trader !== model.entityId) {
      trader = model.entityId;
      tab = null;
    }
    // Each open takes the lists' order and scroll afresh; the tab is kept for the same trader.
    houseA.reset();
    houseB.reset();
    if (title !== null) write(title, formatMessage(copy.tradeWindow.title, { name: model.name }));
    window.open();
    placeWindow();
    paint(trade);
  };

  return {
    isOpen: () => window.isOpen() && !window.element.classList.contains(WARM_CLASS),
    open(model): void {
      const trade = windowRoute(model);
      if (trade === null) return;
      deps.centralWindows?.close();
      window.element.classList.remove(WARM_CLASS);
      show(model, trade);
      const selected = tabs.element.querySelector<HTMLElement>('[aria-selected="true"]');
      selected?.focus();
    },
    dismiss: () => window.dismiss(),
    close,
    update(model): void {
      if (!window.isOpen() || window.element.classList.contains(WARM_CLASS)) return;
      const trade = windowRoute(model);
      if (model.entityId !== trader || trade === null) {
        close();
        return;
      }
      paint(trade);
    },
    refresh(): void {
      if (!window.isOpen()) return;
      if (deps.centralWindows?.isOpen() === true) {
        close();
        return;
      }
      placeWindow();
    },
    onDismiss: (listener) => window.onDismiss(listener),
    claims(clientX, clientY): boolean {
      if (!window.isOpen()) return false;
      const hit = document.elementFromPoint(clientX, clientY);
      return hit !== null && window.element.contains(hit);
    },
    veil(on): void {
      if (on) tips.hide();
      window.element.classList.toggle(VEIL_CLASS, on);
    },
    warm(model): void {
      const trade = windowRoute(model);
      if (trade === null) return;
      window.element.classList.add(WARM_CLASS);
      show(model, trade);
      // Two frames: the first commits the style, the second rasters it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!window.element.classList.contains(WARM_CLASS)) return;
          window.element.classList.remove(WARM_CLASS);
          window.close();
          trader = null;
        }),
      );
    },
    dispose(): void {
      tips.dispose();
      window.dispose();
    },
  };
}
