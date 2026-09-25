import { messages } from '../../../../i18n/index.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, ROW_TEXT_PAD } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';

/** The trade agreements window: one "you give N X, you get M Y" line per agreement the house offers. Authored;
 *  the original shows a foreign trade house's agreements in its own house window. */
export function drawOffersSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  s: number,
): void {
  if (layout.offers === null) return;
  chrome.window(layout.offers.frame);
  chrome.headline(layout.offers.title, messages().hud.tradeOffers);
  layout.offerRows.forEach((row, i) => {
    const line = model.tradeOffers[i];
    if (line !== undefined) chrome.textAt(line, row.x, row.y + ROW_TEXT_PAD * s, 'white');
  });
}
