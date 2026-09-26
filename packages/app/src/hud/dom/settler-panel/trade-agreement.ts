import { formatMessage, messages } from '../../../i18n/index.js';
import type { SettlerPanelModel, TradeOfferModel, TradePanelModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setTip, write } from '../parts/dom.js';
import type { SettlerPanelDeps } from './actions.js';

/** Design px of a good on an agreement chip (foundation.css `.on-offer`). */
const OFFER_ICON_PX = 18;

function offersKey(trade: TradePanelModel): string {
  return trade.offers
    .map((offer) => `${offer.index}:${offer.give.goodType}.${offer.take.goodType}`)
    .join('|');
}

/** A meter's fill as a CSS percentage of `whole`. */
function fillOf(part: number, whole: number): string {
  return `${Math.round((Math.min(part, whole) / Math.max(1, whole)) * 100)}%`;
}

function offerTooltip(trade: TradePanelModel, offer: TradeOfferModel): string {
  const hud = messages().hud;
  const copy = hud.settlerPanel;
  const terms = formatMessage(copy.agreementTooltip, {
    giveAmount: offer.give.amount,
    give: offer.give.label,
    takeAmount: offer.take.amount,
    take: offer.take.label,
  });
  if (offer.progress === null) return terms;
  const state = trade.agreementHolds
    ? formatMessage(hud.tradeExchange, {
        given: offer.progress.given,
        giveAmount: offer.give.amount,
        received: offer.progress.received,
        takeAmount: offer.take.amount,
      })
    : hud.tradeNotFriends;
  return `${terms} · ${state} · ${copy.agreementDrop}`;
}

interface OfferView {
  readonly slot: HTMLElement;
  readonly chip: HTMLButtonElement;
  readonly given: HTMLElement;
  readonly received: HTMLElement;
}

/** Umowa: the foreign stop's agreements as single-choice chips "2 [wood] → 1 [leather]"; under the
 *  chosen one a thin meter of the running exchange, the half given and the half received. */
export interface TradeAgreement {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
}

export function createTradeAgreement(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): TradeAgreement {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const row = element('div', 'on-ledger on-ledger--ctl on-trade-agreement', '<span></span>');
  const label = row.firstElementChild;
  if (label === null) throw new Error('trade: agreement row');
  const offers = element('span', 'on-offers');
  row.append(offers);
  let shown = '';
  let views: OfferView[] = [];

  const offerView = (offer: TradeOfferModel): OfferView => {
    const slot = element('span', 'on-offer-slot');
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
      const live = current()?.trade?.offers.find((candidate) => candidate.index === offer.index);
      actions.setTradeAgreement(id(), live?.selected === true ? -1 : offer.index);
    });
    const meter = element('span', 'on-offer__meter');
    const given = element('span', 'on-meter on-meter--mini');
    const received = element('span', 'on-meter on-meter--mini');
    meter.append(given, received);
    slot.append(chip, meter);
    return { slot, chip, given, received };
  };

  return {
    element: row,
    update(trade): void {
      write(label, messages().hud.settlerPanel.agreement);
      const key = offersKey(trade);
      if (key !== shown) {
        shown = key;
        views = trade.offers.map(offerView);
        offers.replaceChildren(...views.map((view) => view.slot));
      }
      trade.offers.forEach((offer, index) => {
        const view = views[index];
        if (view === undefined) return;
        setAttribute(view.chip, 'aria-pressed', String(offer.selected));
        setAttribute(view.chip, 'aria-label', offer.label);
        setTip(view.chip, offerTooltip(trade, offer));
        setClass(view.slot, 'on-offer-slot--running', offer.progress !== null);
        setClass(view.slot, 'on-offer-slot--stalled', offer.progress !== null && !trade.agreementHolds);
        const progress = offer.progress ?? { given: 0, received: 0 };
        const given = fillOf(progress.given, offer.give.amount);
        const received = fillOf(progress.received, offer.take.amount);
        if (view.given.style.getPropertyValue('--value') !== given)
          view.given.style.setProperty('--value', given);
        if (view.received.style.getPropertyValue('--value') !== received) {
          view.received.style.setProperty('--value', received);
        }
      });
    },
  };
}
