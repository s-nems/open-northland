import { formatMessage, messages } from '../../../../i18n/index.js';
import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { BAR_H, type BuildingLayout, STOCK_ROW_H } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { ROW_TEXT_PAD } from '../shared.js';
import { STOCK_AMOUNT_INSET, STOCK_ICON_W } from './shared.js';

/** Where the production row's long progress bar starts (design px) — a fixed label column that fits the
 *  output icon + a localized name like "Pszenica x1"; the bar fills the rest of the row's width. */
const PRODUCTION_BAR_LEFT = 128;

/**
 * Production window ('Produkcja' is a named approximation — no extracted title): a farm shows its live
 * field counters (sown/growing/ripe, no recipe to bar); a workshop shows the output icon + name and one
 * long progress bar per reserved operator row, so a twin-staffed mill always shows two and the section
 * never changes height mid-work.
 */
export function drawProductionSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  s: number,
): void {
  if (layout.production === null || model.production === null) return;
  chrome.window(layout.production.frame);
  chrome.headline(layout.production.title, messages().hud.production);
  const body = layout.production.body;
  if (model.production.kind === 'fields') {
    const p = model.production;
    const icon: Rect = {
      x: body.x,
      y: body.y + Math.round(s),
      w: Math.round(STOCK_ICON_W * s),
      h: Math.round(STOCK_ROW_H * s) - Math.round(2 * s),
    };
    if (p.goodId !== undefined) chrome.goodIcon(p.goodId, icon);
    const counters = formatMessage(messages().hud.fieldCounters, {
      sown: p.sown,
      growing: p.growing,
      ripe: p.ripe,
    });
    chrome.textAt(
      counters,
      icon.x + icon.w + Math.round(STOCK_AMOUNT_INSET * s),
      body.y + ROW_TEXT_PAD * s,
      'white',
    );
  } else {
    const p = model.production;
    const rowH = Math.round(STOCK_ROW_H * s);
    const icon: Rect = {
      x: body.x,
      y: body.y + Math.round(s),
      w: Math.round(STOCK_ICON_W * s),
      h: rowH - Math.round(2 * s),
    };
    if (p.goodId !== undefined) chrome.goodIcon(p.goodId, icon);
    chrome.textAt(
      p.label,
      icon.x + icon.w + Math.round(STOCK_AMOUNT_INSET * s),
      body.y + ROW_TEXT_PAD * s,
      'white',
    );
    const barX = body.x + Math.round(PRODUCTION_BAR_LEFT * s);
    const bars = Array.from({ length: p.rows }, (_, i) => p.pcts[i] ?? 0);
    bars.forEach((pct, i) => {
      chrome.bar(
        {
          x: barX,
          y: body.y + i * rowH + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
          w: body.x + body.w - barX,
          h: Math.round(BAR_H * s),
        },
        pct,
      );
    });
  }
}
