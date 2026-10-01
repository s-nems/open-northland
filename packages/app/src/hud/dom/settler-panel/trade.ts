import { formatMessage, messages } from '../../../i18n/index.js';
import type { TradePanelModel, TraderSubject } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';
import { createTradeAgreement } from './trade-agreement.js';
import { createTradeStops } from './trade-stops.js';
import { createTradeTransfers, fitTransferLines } from './trade-transfers.js';

/** What the section shows beside and under its stop rows: the configure button and the transfers of
 *  two own stops, the foreign stop's agreements, or nothing more while a stop is missing. A route
 *  never has both; the warm-up model does, so one paint rasters both. */
export interface TradeBody {
  readonly own: boolean;
  readonly agreement: boolean;
}

export function bodyOf(trade: TradePanelModel): TradeBody {
  return { own: trade.stock !== null, agreement: trade.foreign };
}

/**
 * Trade: the route's two slot rows, joined at the right by the configure button while both stops are
 * own houses, then the transfers as read-only lines, or the agreement. Open for every person; when
 * the panel would run past the plane with the other foldable sections folded, it lists only the
 * transfer lines that fit, the last one kept linking to the trade window for the rest. With no room
 * even for that link, or for the agreements, it folds to the stop rows behind "jeszcze N" in its
 * title, and opens again on a click or for another person.
 */
export interface TradeSection {
  readonly element: HTMLElement;
  /** True when the section changed shape, so the owner asks the frame whether everything fits. */
  update(model: TraderSubject, fresh: boolean): boolean;
  /** Every transfer line back, for the owner's fit pass to measure the panel in full. */
  unfit(): void;
  /** The panel, measured in full, stands `overflow` px past the plane: keep the lines that fit, or
   *  fold. */
  fit(overflow: number): void;
  /** The configure button, where focus returns when the trade window closes. */
  focusConfigure(): void;
}

export function createTradeSection(
  deps: SettlerPanelDeps,
  current: () => TraderSubject | null,
  onConfigure: () => void,
): TradeSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const stops = createTradeStops(deps, current);
  const joint = element('div', 'on-trade-joint');
  const configure = button('on-medallion on-trade-configure', GLYPH.scales);
  configure.addEventListener('click', onConfigure);
  joint.append(configure);
  const route = element('div', 'on-trade-route');
  route.append(stops.element, joint);
  const lines = createTradeTransfers(deps, onConfigure);
  const agreement = createTradeAgreement(deps, current);
  const root = element('div', '');
  root.append(title.element, route, lines.element, agreement.element);
  let open = true;
  /** The section had to fold for this person, so the toggle stays offered while it is open again. */
  let folded = false;
  let body: TradeBody = { own: false, agreement: false };
  let shape = '';
  /** What "jeszcze N" counts: the transfers or the agreements the fold hides. */
  let hidden = 0;
  let transfers = 0;

  const paintToggle = (): void => {
    const copy = messages().hud.settlerPanel;
    setHidden(toggle, !folded);
    write(
      toggle,
      open ? copy.fewerRows : hidden > 0 ? formatMessage(copy.moreRows, { count: hidden }) : copy.unfold,
    );
    setAttribute(toggle, 'aria-expanded', String(open));
    setHidden(joint, !body.own);
    setHidden(lines.element, !open || !body.own);
    setHidden(agreement.element, !open || !body.agreement);
  };
  const fold = (): void => {
    if (!open || hidden === 0) return;
    open = false;
    folded = true;
    paintToggle();
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
      setTip(configure, copy.settlerPanel.tradeConfigure);
      setAttribute(configure, 'aria-label', copy.settlerPanel.tradeConfigure);
      if (body.own) lines.update(trade.transfers);
      if (body.agreement) agreement.update(trade);
      transfers = body.own ? trade.transfers.length : 0;
      hidden = transfers + (body.agreement ? trade.offers.length : 0);
      const next = `${body.own}:${body.agreement}:${hidden}`;
      const reshaped = next !== shape;
      shape = next;
      paintToggle();
      return fresh || reshaped;
    },
    unfit: () => lines.uncap(),
    fit(overflow): void {
      if (!open) return;
      const fit = body.own ? fitTransferLines(transfers, overflow, lines.lineHeight()) : null;
      if (fit !== null) {
        lines.cap(fit);
        return;
      }
      // Not even the link fits: folded, the section opens again on the link alone.
      lines.cap({ lines: 0, more: transfers });
      fold();
    },
    focusConfigure(): void {
      if (!joint.hidden) configure.focus();
    },
  };
}
