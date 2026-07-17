import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { BAR_H, type BuildingLayout, ROW_TEXT_PAD, STOCK_PLATE_H, STOCK_ROW_H } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { STOCK_AMOUNT_INSET, STOCK_ICON_W, stockAmount } from './shared.js';

/** Where the construction gauge starts (design px) — a narrow label column that fits the "100%" text. */
const CONSTRUCTION_BAR_LEFT = 40;

/**
 * Construction window (a site only): the health gauge that ramps with the build (the sim raises hitpoints
 * in step with `built`) beside the numeric %, then one stock-style row per material line reading
 * "delivered / needed". No extracted title exists for a site window — 'Construction' is a named
 * approximation (English pending the i18n pass), like 'Produkcja'.
 */
export function drawConstructionSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  s: number,
): void {
  if (layout.construction === null || model.construction === null) return;
  chrome.window(layout.construction.frame);
  chrome.headline(layout.construction.title, 'Construction');
  const body = layout.construction.body;
  const rowH = Math.round(STOCK_ROW_H * s);
  chrome.textAt(`${model.builtPct}%`, body.x, body.y + ROW_TEXT_PAD * s, 'white');
  const barX = body.x + Math.round(CONSTRUCTION_BAR_LEFT * s);
  chrome.bar(
    {
      x: barX,
      y: body.y + Math.round((STOCK_ROW_H - BAR_H) * s) / 2,
      w: body.x + body.w - barX,
      h: Math.round(BAR_H * s),
    },
    model.construction.hpPct ?? model.builtPct,
    'gauge',
  );
  model.construction.rows.forEach((row, i) => {
    const rowY = body.y + (i + 1) * rowH;
    const icon: Rect = {
      x: body.x,
      y: rowY + Math.round(s),
      w: Math.round(STOCK_ICON_W * s),
      h: rowH - Math.round(2 * s),
    };
    const plate: Rect = {
      x: body.x + icon.w,
      y: rowY + Math.round((STOCK_ROW_H - STOCK_PLATE_H) * s) / 2,
      w: Math.round(body.w / 2),
      h: Math.round(STOCK_PLATE_H * s),
    };
    chrome.stockField(plate);
    if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
    chrome.textLeftMiddle(
      stockAmount(row.delivered, row.needed),
      plate.x + Math.round(STOCK_AMOUNT_INSET * s),
      plate.y + plate.h / 2,
      'white',
    );
  });
}
