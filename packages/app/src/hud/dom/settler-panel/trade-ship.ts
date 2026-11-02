import { messages } from '../../../i18n/index.js';
import type { TradePanelModel, TraderSubject } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createRoundButton } from '../parts/round-button.js';
import type { SettlerPanelDeps } from './actions.js';

/** The ship row under the stops, always present so the section never changes height with the pin: the
 *  ship as a link with its hold in the tooltip and the detach, or the link that arms the pin pick, then
 *  why the route cannot sail as it stands. */
export interface TradeShipRow {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
}

export function createTradeShipRow(
  deps: SettlerPanelDeps,
  current: () => TraderSubject | null,
): TradeShipRow {
  const { actions } = deps;
  const list = element('ul', 'on-stops on-trade-ship');
  const item = element('li', 'on-stop');
  const badge = element('span', 'on-stop__badge', GLYPH.anchor);
  const link = button('on-ledger__link on-stop__name');
  link.addEventListener('click', () => {
    const trader = current();
    const ship = trader?.trade?.ship.ship;
    if (trader === null || ship === undefined) return;
    if (ship === null) actions.pinTradeShip(trader.entityId);
    else actions.show(ship.entity);
  });
  const note = element('span', 'on-stop__note');
  const house = element('span', 'on-stop__house');
  house.append(link, note);
  const gap = element('span', '');
  const detach = createRoundButton('ledger', () => {
    const trader = current();
    if (trader !== null) actions.unpinTradeShip(trader.entityId);
  });
  item.append(badge, house, gap, detach.element);
  list.append(item);

  return {
    element: list,
    update(trade): void {
      const copy = messages().hud.settlerPanel;
      const { ship, note: why } = trade.ship;
      setClass(item, 'on-stop--empty', ship === null);
      setClass(link, 'on-ledger--missing', ship === null);
      write(link, ship?.label ?? copy.tradePinShip);
      setTip(link, ship?.load ?? copy.tradePinShipHint);
      setHidden(note, why === null);
      if (why !== null) {
        write(note, why.label);
        setTip(note, why.tooltip);
      }
      detach.update(
        ship === null
          ? null
          : {
              face: { glyph: GLYPH.close },
              label: copy.tradeUnpinShip,
              tooltip: copy.tradeUnpinShip,
            },
      );
    },
  };
}
