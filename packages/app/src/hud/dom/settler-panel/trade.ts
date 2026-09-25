import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  SettlerPanelModel,
  TradeOfferModel,
  TradePanelModel,
  TradeStopModel,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, setTitle, write } from '../parts/dom.js';
import { createRoundButton, type RoundButton } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

/** Design px of a good on an agreement chip (foundation.css `.on-offer`). */
const OFFER_ICON_PX = 18;

/** What decides the stop rows' elements: the houses and each one's import goods. */
function stopsKey(trade: TradePanelModel): string {
  return trade.stops
    .map(
      (stop) =>
        `${stop.house}${stop.foreign ? 'f' : ''}:${stop.imports.map((mark) => mark.goodType).join('.')}`,
    )
    .join('|');
}

function offersKey(trade: TradePanelModel): string {
  return trade.offers
    .map((offer) => `${offer.index}:${offer.give.goodType}.${offer.take.goodType}`)
    .join('|');
}

interface StopView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly imports: readonly RoundButton[];
  readonly remove: RoundButton;
}

/** Handel: the add button in the title, one row per stop (its name, its import toggles, a remove
 *  button) and the map's agreements as single-choice chips. */
export interface TradeSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createTradeSection(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): TradeSection {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const add = createRoundButton('title', () => actions.attachTradeHouse(id()));
  const title = createSection(add.element);
  const root = element('div', '');
  const stops = element('ul', 'on-stops');
  const agreement = element('div', 'on-ledger on-ledger--ctl', '<span></span>');
  const agreementLabel = agreement.firstElementChild;
  if (agreementLabel === null) throw new Error('trade: agreement row');
  const offers = element('span', 'on-offers');
  agreement.append(offers);
  root.append(title.element, stops, agreement);

  let shownStops = '';
  let stopViews: StopView[] = [];
  let shownOffers = '';
  let offerViews: HTMLButtonElement[] = [];

  const stopView = (stop: TradeStopModel): StopView => {
    const item = element('li', 'on-stop');
    const row = element('div', 'on-ledger on-ledger--ctl');
    const name = element('b', 'on-stop__name');
    const importRow = element('span', 'on-imports');
    const imports = stop.imports.map((mark) => {
      const toggle = createRoundButton(
        'toggle',
        () => {
          const live = current()?.trade?.stops.find((s) => s.house === stop.house);
          const selected = live?.imports.find((m) => m.goodType === mark.goodType)?.selected ?? false;
          actions.setTradeImport(id(), stop.house, mark.goodType, !selected);
        },
        deps.icons,
      );
      importRow.append(toggle.element);
      return toggle;
    });
    const remove = createRoundButton('ledger', () => actions.detachTradeHouse(id(), stop.house));
    const buttons = element('span', 'on-ledger__btns');
    buttons.append(remove.element);
    row.append(name, importRow, buttons);
    item.append(row);
    return { item, name, imports, remove };
  };

  const offerView = (offer: TradeOfferModel): HTMLButtonElement => {
    const chip = button(
      'on-offer',
      `${offer.give.amount}${goodIconMarkup(OFFER_ICON_PX)}${GLYPH.arrow}${offer.take.amount}${goodIconMarkup(OFFER_ICON_PX)}`,
    );
    const [giveFrame, takeFrame] = chip.querySelectorAll('.on-good__frame');
    if (giveFrame instanceof HTMLElement && offer.give.goodId !== undefined) {
      deps.icons(giveFrame, offer.give.goodId, OFFER_ICON_PX);
    }
    if (takeFrame instanceof HTMLElement && offer.take.goodId !== undefined) {
      deps.icons(takeFrame, offer.take.goodId, OFFER_ICON_PX);
    }
    chip.addEventListener('click', () => {
      const live = current()?.trade?.offers.find((o) => o.index === offer.index);
      actions.setTradeAgreement(id(), live?.selected === true ? -1 : offer.index);
    });
    return chip;
  };

  return {
    element: root,
    update(model): void {
      const trade = model.trade;
      setHidden(root, trade === null);
      if (trade === null) return;
      const copy = messages().hud;
      const panel = copy.settlerPanel;
      title.update(copy.trade);
      add.update({
        face: { glyph: GLYPH.house },
        label: copy.tradeAttachHouse,
        tooltip: copy.tradeAttachHouseHint,
        enabled: trade.canAttach,
      });
      const key = stopsKey(trade);
      if (key !== shownStops) {
        shownStops = key;
        stopViews = trade.stops.map(stopView);
        stops.replaceChildren(...stopViews.map((view) => view.item));
      }
      trade.stops.forEach((stop, index) => {
        const view = stopViews[index];
        if (view === undefined) return;
        setClass(view.item, 'on-stop--foreign', stop.foreign);
        write(view.name, stop.label);
        setTitle(
          view.name,
          formatMessage(stop.foreign ? panel.tradeForeignStop : panel.tradeStop, { house: stop.label }),
        );
        stop.imports.forEach((mark, markIndex) => {
          view.imports[markIndex]?.update({
            face: { goodId: mark.goodId },
            label: mark.label,
            tooltip: formatMessage(mark.selected ? panel.importOn : panel.importOff, { good: mark.label }),
            pressed: mark.selected,
          });
        });
        view.remove.update({
          face: { glyph: GLYPH.close },
          label: copy.tradeDetachHouse,
          tooltip: copy.tradeDetachHouse,
        });
      });
      setHidden(agreement, trade.offers.length === 0);
      write(agreementLabel, panel.agreement);
      const offerKey = offersKey(trade);
      if (offerKey !== shownOffers) {
        shownOffers = offerKey;
        offerViews = trade.offers.map(offerView);
        offers.replaceChildren(...offerViews);
      }
      trade.offers.forEach((offer, index) => {
        const chip = offerViews[index];
        if (chip === undefined) return;
        setAttribute(chip, 'aria-pressed', String(offer.selected));
        setTitle(
          chip,
          formatMessage(panel.agreementTooltip, {
            giveAmount: offer.give.amount,
            give: offer.give.label,
            takeAmount: offer.take.amount,
            take: offer.take.label,
          }),
        );
      });
    },
  };
}
