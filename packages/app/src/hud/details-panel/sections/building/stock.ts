import { GUI_FRAME, guiFrameIndex } from '../../../../content/gui-atlas-map.js';
import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, STOCK_PLATE_H, STOCK_ROW_H, stockSlotRects } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { visibleStockRows } from '../../stock-tabs.js';
import { HOUSEWINDOW, STOCK_AMOUNT_INSET, STOCK_ICON_W, stockAmount } from './shared.js';

/** Lime underline height for the active stock tab, in design px. */
const STOCK_TAB_UNDERLINE_H = 2;

/** Stock window (Magazyn): a compact store lists every good, a full store one category tab. */
export function drawStockSection(
  chrome: Chrome,
  layout: BuildingLayout,
  model: BuildingPanelModel,
  ui: UiString,
  activeTab: number,
  s: number,
): void {
  if (layout.stock === null) return;
  chrome.window(layout.stock.frame);
  chrome.headline(layout.stock.title, ui('housewindow', HOUSEWINDOW.stock, messages().hud.stock));
  if (!layout.stockCompact) drawStockTabs(chrome, layout.stockTabHits, activeTab, s);
  const body = layout.stock.body;
  const slots = stockSlotRects(body, s, layout.stockRows);
  const cellH = Math.round(STOCK_ROW_H * s);
  const rows = visibleStockRows(model.stock, layout.stockCompact, activeTab);
  const shown = rows.slice(0, layout.stockRows * 2);
  shown.forEach((row, i) => {
    const slot = slots[i];
    if (slot === undefined) return;
    // Icon, plate and amount share the row's vertical centre.
    const icon: Rect = {
      x: slot.x,
      y: slot.y + Math.round(s),
      w: Math.round(STOCK_ICON_W * s),
      h: cellH - Math.round(2 * s),
    };
    const plate: Rect = {
      x: slot.x + icon.w,
      y: slot.y + Math.round((STOCK_ROW_H - STOCK_PLATE_H) * s) / 2,
      w: slot.w - icon.w,
      h: Math.round(STOCK_PLATE_H * s),
    };
    chrome.stockField(plate);
    // Drawn after the plate so an oversized pile overlaps its edge instead of clipping.
    if (row.goodId !== undefined) chrome.goodIcon(row.goodId, icon);
    chrome.textLeftMiddle(
      stockAmount(row.amount, row.capacity),
      plate.x + Math.round(STOCK_AMOUNT_INSET * s),
      plate.y + plate.h / 2,
      'white',
    );
  });
  if (rows.length > shown.length) {
    chrome.textRight(`+${rows.length - shown.length}`, body.x + body.w, body.y - Math.round(2 * s), 'dimmed');
  }
}

/**
 * Original tab-plate glyph per details tab. The glyph semantics are undecoded, so pairing each frame
 * with a category is an approximation identified by eye.
 */
const STOCK_TAB_GLYPH: readonly (number | undefined)[] = [
  GUI_FRAME.stock_tab_0 + 7, // 0 Wszystkie - assorted-goods pile
  GUI_FRAME.stock_tab_0 + 2, // 1 Żywność - cutlery
  guiFrameIndex('resource_icon_water_drop'), // 2 Napoje - water drop, the tab set has no drink glyph
  GUI_FRAME.stock_tab_0 + 4, // 3 Surowce - unread glyph
  GUI_FRAME.stock_tab_0 + 1, // 4 Budulec - house
  GUI_FRAME.stock_tab_0 + 0, // 5 Narzędzia - hammer
  GUI_FRAME.stock_tab_0 + 5, // 6 Wyroby - boots
  GUI_FRAME.stock_tab_0 + 6, // 7 Wojsko - weapon
  GUI_FRAME.stock_tab_0 + 3, // 8 Inne - shears
];

/**
 * Justifying the tabs across the body width and drawing the glyphs through `bg_invert` are legibility
 * approximations, not read from the original.
 */
function drawStockTabs(chrome: Chrome, rects: readonly Rect[], activeTab: number, s: number): void {
  rects.forEach((r, i) => {
    chrome.tabButton(r, i === activeTab);
    const glyph = STOCK_TAB_GLYPH[i];
    if (glyph !== undefined) chrome.guiCentered(glyph, r, 'magenta', 'bg_invert');
  });
  const active = rects[activeTab];
  if (active !== undefined) {
    const underlineH = Math.max(2, Math.round(STOCK_TAB_UNDERLINE_H * s));
    chrome.selectedUnderline({
      x: active.x,
      y: active.y + active.h - underlineH,
      w: active.w,
      h: underlineH,
    });
  }
}
