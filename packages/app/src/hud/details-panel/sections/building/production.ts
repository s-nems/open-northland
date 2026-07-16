import { formatMessage, messages } from '../../../../i18n/index.js';
import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { BAR_H, type BuildingLayout, STOCK_ROW_H } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { ROW_TEXT_PAD } from '../shared.js';
import { STOCK_AMOUNT_INSET, STOCK_ICON_W } from './shared.js';

/** Where a production row's long progress bar starts (design px) — a fixed label column on the LEFT of
 *  every row that fits the product's icon + a localized name like "Zbroja płytowa"; the bar fills the
 *  rest of the row's width. */
const PRODUCTION_BAR_LEFT = 128;

/**
 * Production window ('Produkcja' is a named approximation — no extracted title): a farm shows its live
 * field counters (sown/growing/ripe, no recipe to bar); a workshop shows one row PER PRODUCIBLE GOOD —
 * the product's icon + name on the left, its front-runner batch's progress bar on the right (a smithy 2
 * lists all five wares; the recipe-inputs tooltip lives in the panel's cursor probe, not here).
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
  const rowH = Math.round(STOCK_ROW_H * s);
  const rowIcon = (rowY: number): Rect => ({
    x: body.x,
    y: rowY + Math.round(s),
    w: Math.round(STOCK_ICON_W * s),
    h: rowH - Math.round(2 * s),
  });
  if (model.production.kind === 'fields') {
    const p = model.production;
    const icon = rowIcon(body.y);
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
    const barX = body.x + Math.round(PRODUCTION_BAR_LEFT * s);
    model.production.rows.forEach((row, i) => {
      const rowY = body.y + i * rowH;
      const icon = rowIcon(rowY);
      if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
      chrome.textAt(
        row.label,
        icon.x + icon.w + Math.round(STOCK_AMOUNT_INSET * s),
        rowY + ROW_TEXT_PAD * s,
        'white',
      );
      chrome.bar(
        {
          x: barX,
          y: rowY + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
          w: body.x + body.w - barX,
          h: Math.round(BAR_H * s),
        },
        row.pct,
      );
    });
  }
}
