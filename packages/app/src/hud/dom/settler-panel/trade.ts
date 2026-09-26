import { formatMessage, messages } from '../../../i18n/index.js';
import type { SettlerPanelModel, TradePanelModel } from '../../details-panel/model/index.js';
import { button, element, setAttribute, setHidden, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';
import { createTradeAgreement } from './trade-agreement.js';
import { createTradeGoods, reservedChipRows } from './trade-goods.js';
import { markedGoods } from './trade-marks.js';
import { createTradeStops } from './trade-stops.js';

/** What the section shows under its stop rows: the goods of two own stops, the foreign stop's
 *  agreements, or, with neither, the line asking for a second stop. A route never has both; the
 *  warm-up model does, so one paint rasters both. */
interface TradeBody {
  readonly goods: boolean;
  readonly agreement: boolean;
}

function bodyOf(trade: TradePanelModel): TradeBody {
  return { goods: trade.categories.length > 0, agreement: trade.foreign };
}

/** What decides the section's height: its bodies and how many chip rows or agreement chips they hold. */
function shapeOf(trade: TradePanelModel, body: TradeBody): string {
  const goods = body.goods ? reservedChipRows(trade.categories) : 0;
  const offers = body.agreement ? trade.offers.length : 0;
  return `${goods}:${offers}`;
}

/**
 * Handel: the route's two slot rows, then the goods or the agreement. Open for every person; when the
 * panel would run past the plane with the other foldable sections folded, it folds to the stop rows
 * behind "jeszcze N" (the marked goods or the agreements) in its title, and opens again on a click or
 * for another person.
 */
export interface TradeSection {
  readonly element: HTMLElement;
  /** True when the section changed shape, so the owner asks the frame whether everything fits. */
  update(model: SettlerPanelModel, fresh: boolean): boolean;
  fold(): void;
}

export function createTradeSection(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): TradeSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const stops = createTradeStops(deps, current);
  const goods = createTradeGoods(deps, current);
  const agreement = createTradeAgreement(deps, current);
  const hint = element('p', 'on-trade-hint');
  const root = element('div', '');
  root.append(title.element, stops.element, goods.element, agreement.element, hint);
  let open = true;
  /** The section had to fold for this person, so the toggle stays offered while it is open again. */
  let folded = false;
  let body: TradeBody = { goods: false, agreement: false };
  let shape = '';
  /** What "jeszcze N" counts: the marked goods or the agreements the fold hides. */
  let hidden = 0;

  const paintToggle = (): void => {
    const copy = messages().hud.settlerPanel;
    setHidden(toggle, !folded);
    write(
      toggle,
      open ? copy.fewerRows : hidden > 0 ? formatMessage(copy.moreRows, { count: hidden }) : copy.unfold,
    );
    setAttribute(toggle, 'aria-expanded', String(open));
    setHidden(goods.element, !open || !body.goods);
    setHidden(agreement.element, !open || !body.agreement);
    setHidden(hint, body.goods || body.agreement);
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
        goods.reset();
      }
      const copy = messages().hud;
      title.update(copy.trade);
      body = bodyOf(trade);
      stops.update(trade);
      if (body.goods) goods.update(trade);
      if (body.agreement) agreement.update(trade);
      write(hint, copy.settlerPanel.tradeNeedsTwo);
      hidden = markedGoods(trade.categories) + (body.agreement ? trade.offers.length : 0);
      const next = shapeOf(trade, body);
      const reshaped = next !== shape;
      shape = next;
      paintToggle();
      return fresh || reshaped;
    },
    fold(): void {
      if (!open || (!body.goods && !body.agreement)) return;
      open = false;
      folded = true;
      paintToggle();
    },
  };
}
