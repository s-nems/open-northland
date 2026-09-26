import { messages } from '../../../i18n/index.js';
import {
  type SettlerPanelModel,
  TRADE_ROUTE_HOUSES,
  type TradePanelModel,
  type TradeStopModel,
} from '../../details-panel/model/index.js';
import { createHouseCardLink, type HouseCardLink } from '../hover-card.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setTip, write } from '../parts/dom.js';
import { createRoundButton, type RoundButton } from '../parts/round-button.js';
import { stopBadge } from '../trade-window/route.js';
import type { SettlerPanelDeps } from './actions.js';

interface SlotRow {
  readonly item: HTMLLIElement;
  /** The house as a link, or the attach link on a free slot. */
  readonly link: HTMLButtonElement;
  readonly heading: HTMLElement;
  readonly detach: RoundButton;
  readonly card: HouseCardLink;
}

/** What a slot row shows: a stop, or the attach link on a free slot. The pick fills the first free
 *  slot whichever free row armed it, so both read the same. */
type SlotState = { readonly kind: 'stop'; readonly stop: TradeStopModel } | { readonly kind: 'attach' };

export function slotState(trade: TradePanelModel, slot: number): SlotState {
  const stop = trade.stops.find((candidate) => candidate.slot === slot);
  return stop === undefined ? { kind: 'attach' } : { kind: 'stop', stop };
}

/** One row per route slot, both always present so the section never changes height with the route:
 *  the A/B badge, the house as a link (a foreign house in amber), the heading arrow and the detach. */
export interface TradeStops {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
}

export function createTradeStops(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): TradeStops {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const liveSlot = (slot: number): SlotState | null => {
    const trade = current()?.trade;
    return trade == null ? null : slotState(trade, slot);
  };
  const list = element('ul', 'on-stops');

  const slotRow = (slot: number): SlotRow => {
    const item = element('li', 'on-stop');
    const badge = element('span', 'on-stop__badge', stopBadge(slot));
    const link = button('on-ledger__link on-stop__name');
    const heading = element('span', 'on-stop__heading', GLYPH.arrow);
    const detach = createRoundButton('ledger', () => {
      const state = liveSlot(slot);
      if (state?.kind === 'stop') actions.detachTradeHouse(id(), state.stop.house);
    });
    link.addEventListener('click', () => {
      const state = liveSlot(slot);
      if (state?.kind === 'stop') actions.show(state.stop.house);
      else if (state?.kind === 'attach') actions.attachTradeHouse(id());
    });
    const card = createHouseCardLink(deps.hoverCard, deps.buildingHover);
    const hover = (event: MouseEvent): void => {
      const state = liveSlot(slot);
      card.hover(state?.kind === 'stop' ? state.stop.house : null, event);
    };
    link.addEventListener('mouseenter', hover);
    link.addEventListener('mousemove', hover);
    link.addEventListener('mouseleave', () => card.hover(null, null));
    item.append(badge, link, heading, detach.element);
    return { item, link, heading, detach, card };
  };
  const rows = Array.from({ length: TRADE_ROUTE_HOUSES }, (_unused, slot) => slotRow(slot));
  list.replaceChildren(...rows.map((row) => row.item));

  return {
    element: list,
    update(trade): void {
      const copy = messages().hud;
      const panel = copy.settlerPanel;
      rows.forEach((row, slot) => {
        const state = slotState(trade, slot);
        row.card.update(state.kind === 'stop' ? state.stop.house : null);
        setClass(row.item, 'on-stop--empty', state.kind !== 'stop');
        setClass(row.item, 'on-stop--foreign', state.kind === 'stop' && state.stop.foreign);
        setClass(row.item, 'on-stop--heading', state.kind === 'stop' && state.stop.heading);
        setClass(row.link, 'on-ledger--missing', state.kind === 'attach');
        setTip(row.heading, panel.tradeHeading);
        switch (state.kind) {
          case 'stop':
            write(row.link, state.stop.label);
            // The hover card is the house's reference; a tooltip would only cover it.
            setTip(row.link, '');
            row.detach.update({
              face: { glyph: GLYPH.close },
              label: copy.tradeDetachHouse,
              tooltip: copy.tradeDetachHouse,
            });
            return;
          case 'attach':
            write(row.link, panel.tradeAddStop);
            setTip(row.link, copy.tradeAttachHouseHint);
            row.detach.update(null);
            return;
        }
      });
    },
  };
}
