import { messages } from '../../../i18n/index.js';
import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { Chrome } from '../chrome.js';
import { type ButtonAction, ROW_TEXT_PAD, type TradeImportHit, type TradeLayout } from '../layout/index.js';
import type { TradePanelModel } from '../model/index.js';

/** Inset of a good icon inside its round import-mark button, so the pile clears the rim. */
const IMPORT_ICON_PAD = 3;
/** Darkening behind the chosen agreement row. */
const OFFER_CHOSEN_SCRIM = 0.25;

/**
 * Handel: one row per stop (detach button + house name) over that stop's import marks, the attach row
 * while a stop is free, the foreign house's agreements as choice rows (the chosen one dotted), and the
 * status lines. The layout is authored; the original configures a trader through its own window.
 */
export function drawTradeSection(
  chrome: Chrome,
  layout: TradeLayout,
  model: TradePanelModel,
  hoverAction: ButtonAction | null,
  hovered: {
    readonly import: {
      readonly house: number;
      readonly pair: number | null;
      readonly goodType: number;
    } | null;
    readonly offer: number | null;
    readonly detach: number | null;
  },
  s: number,
): void {
  const hud = messages().hud;
  chrome.window(layout.section.frame);
  chrome.headline(layout.section.title, hud.trade);
  const iconPad = Math.round(IMPORT_ICON_PAD * s);
  const drawIcon = (rect: Rect, goodId: string | undefined, active: boolean): void => {
    chrome.roundButton(rect, true, active);
    const face: Rect = {
      x: rect.x + iconPad,
      y: rect.y + iconPad,
      w: rect.w - 2 * iconPad,
      h: rect.h - 2 * iconPad,
    };
    if (goodId !== undefined) chrome.goodIcon(goodId, face);
    else chrome.glyphAll(face);
  };

  const drawMark = (hit: TradeImportHit): void => {
    const on = hovered.import;
    const lit = on?.house === hit.house && on.pair === hit.pair && on.goodType === hit.goodType;
    drawIcon(hit.rect, hit.goodId, hit.selected || lit);
  };

  layout.stops.forEach((stop, i) => {
    const stopModel = model.stops[i];
    chrome.textLeftMiddle(stopModel?.label ?? '', stop.label.x, stop.label.y + stop.label.h / 2, 'white');
    chrome.roundButton(stop.detach.rect, stop.detach.enabled, hovered.detach === stop.house);
    chrome.glyphHouse(stop.detach.rect, stop.detach.enabled);
    for (const hit of stop.imports) drawMark(hit);
  });
  if (layout.attach !== null) {
    const { button, label } = layout.attach;
    chrome.textLeftMiddle(hud.tradeAttachHouse, label.x, label.y + label.h / 2, 'white');
    chrome.roundButton(button.rect, button.enabled, hoverAction === 'attach-trade-house');
    chrome.glyphHouse(button.rect, button.enabled);
  }
  if (layout.balanceCaption !== null) {
    const caption = layout.balanceCaption;
    chrome.textAt(hud.tradeBalanceCaption, caption.x, caption.y + ROW_TEXT_PAD * s, 'dimmed');
  }
  for (const hit of layout.balance) drawMark(hit);
  if (layout.offersCaption !== null) {
    const caption = layout.offersCaption;
    chrome.textAt(hud.tradeOffersCaption, caption.x, caption.y + ROW_TEXT_PAD * s, 'dimmed');
  }
  for (const offer of layout.offers) {
    if (offer.selected) chrome.scrim(offer.rect, OFFER_CHOSEN_SCRIM);
    chrome.roundButton(offer.button, true, offer.selected || offer.index === hovered.offer);
    if (offer.selected) chrome.glyphDot(offer.button);
    const labelX = offer.button.x + offer.button.w + Math.round(WIN_PAD * s);
    chrome.textLeftMiddle(
      offer.label,
      labelX,
      offer.rect.y + offer.rect.h / 2,
      'white',
      'body',
      offer.rect.x + offer.rect.w - labelX,
    );
  }
  layout.statusRows.forEach((row, i) => {
    const line = model.status[i];
    if (line !== undefined) chrome.textAt(line, row.x, row.y + ROW_TEXT_PAD * s, 'dimmed');
  });
}
