import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type SettlerPanelModel,
  TRADE_ROUTE_HOUSES,
  type TradePanelModel,
  type TradeStopModel,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createRoundButton, type RoundButton } from '../parts/round-button.js';
import type { SettlerPanelDeps } from './actions.js';

/** The route's stops by slot: A is the first house, B the second. Letters, not words, in every locale. */
const STOP_BADGES: readonly string[] = ['A', 'B'];

export function stopBadge(slot: number): string {
  return STOP_BADGES[slot] ?? String(slot + 1);
}

interface SlotRow {
  readonly item: HTMLLIElement;
  /** The house as a link, or the attach link on the free slot the next house goes to. */
  readonly link: HTMLButtonElement;
  /** A free slot after that one. */
  readonly note: HTMLElement;
  readonly heading: HTMLElement;
  readonly detach: RoundButton;
}

/** What a slot row shows: a stop, the free slot the attach pick fills, or a later free slot. */
type SlotState =
  | { readonly kind: 'stop'; readonly stop: TradeStopModel }
  | { readonly kind: 'attach' }
  | { readonly kind: 'free' };

function slotState(trade: TradePanelModel, slot: number): SlotState {
  const stop = trade.stops.find((candidate) => candidate.slot === slot);
  if (stop !== undefined) return { kind: 'stop', stop };
  return slot === trade.attachSlot ? { kind: 'attach' } : { kind: 'free' };
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
  /** The house the hover card shows; a changed stop takes its card with it, since a relabelled link
   *  never reports the cursor leaving. */
  let carded: number | null = null;

  const slotRow = (slot: number): SlotRow => {
    const item = element('li', 'on-stop');
    const badge = element('span', 'on-stop__badge', stopBadge(slot));
    const link = button('on-ledger__link on-stop__name');
    const note = element('span', 'on-stop__name on-ledger--muted');
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
    const hover = (event: MouseEvent | null): void => {
      const state = liveSlot(slot);
      const house = state?.kind === 'stop' && event !== null ? state.stop.house : null;
      const card = house === null ? null : deps.buildingHover(house);
      carded = card === null ? null : house;
      if (card === null || event === null) deps.hoverCard.hide();
      else deps.hoverCard.show(event.clientX, event.clientY, card);
    };
    link.addEventListener('mouseenter', hover);
    link.addEventListener('mousemove', hover);
    link.addEventListener('mouseleave', () => hover(null));
    item.append(badge, link, note, heading, detach.element);
    return { item, link, note, heading, detach };
  };
  const rows = Array.from({ length: TRADE_ROUTE_HOUSES }, (_unused, slot) => slotRow(slot));
  list.replaceChildren(...rows.map((row) => row.item));

  return {
    element: list,
    update(trade): void {
      const copy = messages().hud;
      const panel = copy.settlerPanel;
      const shownHouses = new Set(trade.stops.map((stop) => stop.house));
      if (carded !== null && !shownHouses.has(carded)) {
        carded = null;
        deps.hoverCard.hide();
      }
      rows.forEach((row, slot) => {
        const state = slotState(trade, slot);
        const badge = stopBadge(slot);
        setClass(row.item, 'on-stop--empty', state.kind !== 'stop');
        setClass(row.item, 'on-stop--foreign', state.kind === 'stop' && state.stop.foreign);
        setClass(row.item, 'on-stop--heading', state.kind === 'stop' && state.stop.heading);
        setHidden(row.link, state.kind === 'free');
        setHidden(row.note, state.kind !== 'free');
        setClass(row.link, 'on-ledger--missing', state.kind === 'attach');
        setTip(row.heading, panel.tradeHeading);
        switch (state.kind) {
          case 'stop':
            write(row.link, state.stop.label);
            setTip(
              row.link,
              formatMessage(state.stop.foreign ? panel.tradeForeignStopTooltip : panel.tradeStopTooltip, {
                badge,
              }),
            );
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
          case 'free':
            write(row.note, panel.tradeFreeSlot);
            setTip(
              row.note,
              formatMessage(panel.tradeFreeSlotTooltip, { badge: stopBadge(trade.attachSlot ?? slot) }),
            );
            row.detach.update(null);
            return;
        }
      });
    },
  };
}
