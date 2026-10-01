import { formatMessage, messages } from '../../../i18n/index.js';
import {
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradePanelModel,
  type TraderSubject,
} from '../../details-panel/model/index.js';
import type { BuildingHoverModel } from '../../hover-card/model.js';
import type { GoodIconPainter } from '../good-art.js';
import type { HoverCard } from '../hover-card.js';
import { element, write } from '../parts/dom.js';
import { attachTipLayer, type TipChip } from '../parts/tip-layer.js';
import { type ClientRect, closePortraitHole, cutPortraitHole } from '../portrait-hole.js';
import type { SettlerPanelActions } from '../settler-panel/actions.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import { createTradeCommands } from './commands.js';
import { createHouseColumn, type HouseColumn } from './house-column.js';
import { windowRoute } from './model.js';
import { createTransfersList } from './transfers.js';

/** Design px: two stock lists side by side, and on the 1365 px plane of a 1280 × 720 screen the centred
 *  window still clears the 318 px settler panel. */
const TRADE_WINDOW_W = 720;
/** The window painted out of sight for its warm-up frame. */
const WARM_CLASS = 'on-window--warm';
/** The fill's holes over the two houses' portraits (foundation.css `--hole-a-*`, `--hole-b-*`). */
const HOLE_A = 'hole-a';
const HOLE_B = 'hole-b';
/** A closed window paints no portrait. */
const NO_PORTRAITS: readonly HousePortrait[] = [];

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
  readonly actions: Pick<SettlerPanelActions, 'show' | 'centre' | 'setTradeMarks' | 'setTradeImportLimits'>;
  readonly centralWindows?: CentralWindows;
}

/** A house's live portrait in the window: the house and the client box the renderer paints it into. */
export interface HousePortrait {
  readonly entityRef: number;
  readonly rect: ClientRect;
}

/**
 * The trade between a trader's two own houses, in the centre of the screen: each house's live portrait, name
 * and own category tabs over its stock, an arrow per good that sets up a transfer into the other house, and
 * the transfers with their direction and limits. It belongs to the selected trader: another selection, a
 * route without two own stops or a beam window opened after it closes it.
 */
export interface TradeWindow {
  isOpen(): boolean;
  /** Open for the settler the model shows, when its route is two own houses. */
  open(model: TraderSubject): void;
  /** Close as the cross does, telling the dismiss listeners. */
  dismiss(): void;
  close(): void;
  /** The shown settler's model; closes the window when it no longer fits. */
  update(model: TraderSubject): void;
  /** Once a frame, after the paint: re-place on a new plane size, yield to a beam window opened after
   *  it, and let a shown tip follow its control. */
  refresh(): void;
  onDismiss(listener: () => void): void;
  claims(clientX: number, clientY: number): boolean;
  /** The client right edge while the window shows, else null. */
  clientRight(): number | null;
  /** Paint once out of sight at map start, so the first open costs no first-paint work. */
  warm(model: TraderSubject): void;
  /** The houses' portraits while the window shows; the same list while nothing moved. */
  portraits(): readonly HousePortrait[];
  /** The HUD scale changed: the portraits' boxes are measured again. */
  invalidate(): void;
  dispose(): void;
}

export function createTradeWindow(deps: TradeWindowDeps): TradeWindow {
  const copy = messages().hud;
  const hudWindow = createHudWindow(deps.plane, {
    title: copy.trade,
    closeLabel: copy.shell.close,
    width: TRADE_WINDOW_W,
    headless: true,
  });
  hudWindow.element.classList.add('on-window--trade');
  hudWindow.body.classList.add('on-window__body--column');
  // The slate under the content, with a hole over each house's portrait (foundation.css).
  const fill = element('div', 'on-window__fill');
  hudWindow.element.prepend(fill);
  const placeWindow = centralWindowPlacer(hudWindow, deps.plane, TRADE_WINDOW_W);
  const tips = attachTipLayer(hudWindow.element, deps.tooltip);

  /** The trader the window is open for, and its model as last painted. */
  let trader: number | null = null;
  let shown: TradePanelModel | null = null;

  const commands = createTradeCommands(deps.actions, () =>
    trader === null || shown === null ? null : { trader, trade: shown },
  );

  const columnDeps = {
    icons: deps.icons,
    hoverCard: deps.hoverCard,
    buildingHover: deps.buildingHover,
    show: (house: number) => deps.actions.show(house),
    centre: (house: number) => deps.actions.centre(house),
    onArrow: commands.arrow,
  };
  const houseA = createHouseColumn(columnDeps, TRADE_SLOT_A);
  const houseB = createHouseColumn(columnDeps, TRADE_SLOT_B);
  const columns: readonly { readonly column: HouseColumn; readonly hole: string }[] = [
    { column: houseA, hole: HOLE_A },
    { column: houseB, hole: HOLE_B },
  ];
  const houses = element('div', 'on-trade-houses');
  houses.append(houseA.element, houseB.element);
  const transfersTitle = element('div', 'on-section on-trade-transfers__title', '<span></span>');
  const transfers = createTransfersList({
    icons: deps.icons,
    setFlow: commands.setFlow,
    setLimits: commands.setLimits,
  });
  const lower = element('div', 'on-trade-transfers');
  lower.append(transfersTitle, transfers.element);
  hudWindow.body.append(houses, lower);

  /** The portraits' client boxes, measured once per change of the layout, the scale or the screen. */
  let holes: readonly ClientRect[] | null = null;
  let dirty = true;
  let listed: readonly HousePortrait[] = NO_PORTRAITS;
  const invalidate = (): void => {
    dirty = true;
  };
  window.addEventListener('resize', invalidate);
  const resizes = new ResizeObserver(invalidate);
  resizes.observe(hudWindow.element);
  const showing = (): boolean => hudWindow.isOpen() && !hudWindow.element.classList.contains(WARM_CLASS);

  const paint = (trade: TradePanelModel): void => {
    shown = trade;
    houseA.update(trade);
    houseB.update(trade);
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
    hudWindow.close();
  };
  hudWindow.onDismiss(() => {
    tips.hide();
    deps.hoverCard.hide();
  });

  const show = (model: TraderSubject, trade: TradePanelModel): void => {
    const again = trader === model.entityId;
    trader = model.entityId;
    for (const { column } of columns) column.reopen(trade, again);
    hudWindow.element.setAttribute('aria-label', formatMessage(copy.tradeWindow.title, { name: model.name }));
    hudWindow.open();
    placeWindow();
    invalidate();
    paint(trade);
  };

  return {
    isOpen: () => hudWindow.isOpen() && !hudWindow.element.classList.contains(WARM_CLASS),
    open(model): void {
      const trade = windowRoute(model);
      if (trade === null) return;
      deps.centralWindows?.close();
      hudWindow.element.classList.remove(WARM_CLASS);
      show(model, trade);
      houseA.focusTabs();
    },
    dismiss: () => hudWindow.dismiss(),
    close,
    update(model): void {
      if (!hudWindow.isOpen() || hudWindow.element.classList.contains(WARM_CLASS)) return;
      const trade = windowRoute(model);
      if (model.entityId !== trader || trade === null) {
        close();
        return;
      }
      paint(trade);
    },
    refresh(): void {
      if (!hudWindow.isOpen()) return;
      if (deps.centralWindows?.isOpen() === true) {
        close();
        return;
      }
      if (placeWindow()) invalidate();
      tips.refresh();
    },
    onDismiss: (listener) => hudWindow.onDismiss(listener),
    claims(clientX, clientY): boolean {
      if (!hudWindow.isOpen()) return false;
      const hit = document.elementFromPoint(clientX, clientY);
      return hit !== null && hudWindow.element.contains(hit);
    },
    clientRight: () => (showing() ? hudWindow.element.getBoundingClientRect().right : null),
    warm(model): void {
      const trade = windowRoute(model);
      if (trade === null) return;
      hudWindow.element.classList.add(WARM_CLASS);
      show(model, trade);
      // Two frames: the first commits the style, the second rasters it.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!hudWindow.element.classList.contains(WARM_CLASS)) return;
          hudWindow.element.classList.remove(WARM_CLASS);
          hudWindow.close();
          trader = null;
        }),
      );
    },
    portraits(): readonly HousePortrait[] {
      if (!showing()) return NO_PORTRAITS;
      if (dirty || holes === null) {
        dirty = false;
        holes = columns.map(({ column, hole }) => cutPortraitHole(fill, column.portrait, hole));
        listed = NO_PORTRAITS;
      }
      const boxes = holes;
      // A new list only when a box was measured again or a house changed under it.
      const stale =
        listed.length !== columns.length ||
        columns.some(({ column }, index) => {
          const was = listed[index];
          return was === undefined || was.entityRef !== column.house() || was.rect !== boxes[index];
        });
      if (stale) {
        const next: HousePortrait[] = [];
        columns.forEach(({ column }, index) => {
          const house = column.house();
          const rect = boxes[index];
          if (house !== null && rect !== undefined) next.push({ entityRef: house, rect });
        });
        listed = next;
      }
      return listed;
    },
    invalidate,
    dispose(): void {
      tips.dispose();
      window.removeEventListener('resize', invalidate);
      resizes.disconnect();
      for (const { hole } of columns) closePortraitHole(fill, hole);
      hudWindow.dispose();
    },
  };
}
