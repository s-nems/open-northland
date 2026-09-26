import { formatMessage, messages } from '../../../i18n/index.js';
import type { SettlerPanelModel, TradePanelModel } from '../../details-panel/model/index.js';
import { button, element, setAttribute, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';
import { createTradeAgreement } from './trade-agreement.js';
import { createTradeStops } from './trade-stops.js';
import { createTradeTransfers } from './trade-transfers.js';

/** What the section shows under its stop rows: the configure button and the transfers of two own
 *  stops, the foreign stop's agreements, or, with neither, the line asking for both stops. A route
 *  never has both; the warm-up model does, so one paint rasters both. */
export interface TradeBody {
  readonly own: boolean;
  readonly agreement: boolean;
}

export function bodyOf(trade: TradePanelModel): TradeBody {
  return { own: trade.stock !== null, agreement: trade.foreign };
}

/**
 * Handel: the route's two slot rows, then "Konfiguruj handel" and the transfers as read-only lines,
 * or the agreement. Open for every person; when the panel would run past the plane with the other
 * foldable sections folded, it folds to the stop rows and the button behind "jeszcze N" (the
 * transfers or the agreements) in its title, and opens again on a click or for another person.
 */
export interface TradeSection {
  readonly element: HTMLElement;
  /** True when the section changed shape, so the owner asks the frame whether everything fits. */
  update(model: SettlerPanelModel, fresh: boolean): boolean;
  fold(): void;
  /** The configure button, where focus returns when the trade window closes. */
  focusConfigure(): void;
}

export function createTradeSection(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
  onConfigure: () => void,
): TradeSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const stops = createTradeStops(deps, current);
  const configure = button('on-button on-button--rounded on-trade-configure');
  configure.addEventListener('click', onConfigure);
  const lines = createTradeTransfers(deps);
  const agreement = createTradeAgreement(deps, current);
  const hint = element('p', 'on-trade-hint');
  const root = element('div', '');
  root.append(title.element, stops.element, configure, lines.element, agreement.element, hint);
  let open = true;
  /** The section had to fold for this person, so the toggle stays offered while it is open again. */
  let folded = false;
  let body: TradeBody = { own: false, agreement: false };
  let shape = '';
  /** What "jeszcze N" counts: the transfers or the agreements the fold hides. */
  let hidden = 0;

  const paintToggle = (): void => {
    const copy = messages().hud.settlerPanel;
    setHidden(toggle, !folded);
    write(
      toggle,
      open ? copy.fewerRows : hidden > 0 ? formatMessage(copy.moreRows, { count: hidden }) : copy.unfold,
    );
    setAttribute(toggle, 'aria-expanded', String(open));
    setHidden(configure, !body.own);
    setHidden(lines.element, !open || !body.own);
    setHidden(agreement.element, !open || !body.agreement);
    setHidden(hint, body.own || body.agreement);
  };
  toggle.addEventListener('click', () => {
    open = !open;
    paintToggle();
  });

  return {
    element: root,
    update(model, fresh): boolean {
      const trade = model.trade;
      setHidden(root, trade === null);
      if (trade === null) return false;
      if (fresh) {
        open = true;
        folded = false;
      }
      const copy = messages().hud;
      title.update(copy.trade);
      body = bodyOf(trade);
      stops.update(trade);
      write(configure, copy.settlerPanel.tradeConfigure);
      setTip(configure, copy.settlerPanel.tradeConfigureTooltip);
      if (body.own) lines.update(trade.transfers);
      if (body.agreement) agreement.update(trade);
      write(hint, copy.settlerPanel.tradeNeedsTwo);
      hidden = (body.own ? trade.transfers.length : 0) + (body.agreement ? trade.offers.length : 0);
      const next = `${body.own}:${body.agreement}:${hidden}`;
      const reshaped = next !== shape;
      shape = next;
      paintToggle();
      return fresh || reshaped;
    },
    fold(): void {
      if (!open || hidden === 0) return;
      open = false;
      folded = true;
      paintToggle();
    },
    focusConfigure(): void {
      if (!configure.hidden) configure.focus();
    },
  };
}
