import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingOfferModel, BuildingPanelModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { element, setAttribute, setHidden, setTip } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';

/** Design px of a good on an agreement chip (foundation.css `.on-offer`). */
const OFFER_ICON_PX = 18;

/** Trade agreements: the agreements this house offers a visiting trader, read-only chips
 *  "1 [coin] → 4 [iron]" as the trader's Agreement shows them. */
export interface OffersSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

function offerKey(offer: BuildingOfferModel): string {
  return `${offer.give.amount}.${offer.give.goodType}>${offer.take.amount}.${offer.take.goodType}`;
}

export function createOffersSection(deps: BuildingPanelDeps): OffersSection {
  const title = createSection();
  const chips = element('div', 'on-offers');
  const root = element('div', '');
  root.append(title.element, chips);
  let shape = '';
  return {
    element: root,
    update(model): void {
      setHidden(root, model.offers.length === 0);
      if (model.offers.length === 0) return;
      const copy = messages().hud;
      title.update(copy.buildingPanel.offers);
      const next = model.offers.map(offerKey).join('|');
      if (next === shape) return;
      shape = next;
      chips.replaceChildren(
        ...model.offers.map((offer) => {
          const chip = element(
            'span',
            'on-offer',
            `${offer.give.amount}${goodIconMarkup(OFFER_ICON_PX)}${GLYPH.arrow}${offer.take.amount}${goodIconMarkup(OFFER_ICON_PX)}`,
          );
          const [giveFrame, takeFrame] = chip.querySelectorAll('.on-good__frame');
          if (giveFrame instanceof HTMLElement && offer.give.goodId !== undefined)
            deps.icons(giveFrame, offer.give.goodId, OFFER_ICON_PX);
          if (takeFrame instanceof HTMLElement && offer.take.goodId !== undefined)
            deps.icons(takeFrame, offer.take.goodId, OFFER_ICON_PX);
          const words = formatMessage(copy.settlerPanel.agreementTooltip, {
            giveAmount: offer.give.amount,
            give: offer.give.label,
            takeAmount: offer.take.amount,
            take: offer.take.label,
          });
          setTip(chip, words);
          setAttribute(chip, 'aria-label', words);
          return chip;
        }),
      );
    },
  };
}
