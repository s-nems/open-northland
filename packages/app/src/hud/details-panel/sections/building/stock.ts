import { GUI_FRAME, guiFrameIndex } from '../../../../content/gui-atlas-map.js';
import type { UiString } from '../../../../content/gui-gfx.js';
import { messages } from '../../../../i18n/index.js';
import type { Rect } from '../../../geometry.js';
import type { Chrome } from '../../chrome.js';
import { type BuildingLayout, STOCK_PLATE_H, STOCK_ROW_H, stockSlotRects } from '../../layout/index.js';
import type { BuildingPanelModel } from '../../model/index.js';
import { visibleStockRows } from '../../stock-tabs.js';
import { HOUSEWINDOW, STOCK_AMOUNT_INSET, STOCK_ICON_W, stockAmount } from './shared.js';

/** The active stock tab's lime underline height in design px (kept ≥2 screen px so it reads at uiscale 1). */
const STOCK_TAB_UNDERLINE_H = 2;

/**
 * Stock window (Magazyn): a compact store lists every good in its declared slot order (stable while amounts
 * change); the full fixed-height store shows the active category tab and bubbles held goods above the fold.
 */
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
  // The fixed cell grid both the drawing and the hover hit-test share (column-major, two columns).
  const slots = stockSlotRects(body, s, layout.stockRows);
  const cellH = Math.round(STOCK_ROW_H * s);
  // The one shared row source (draw == hover hit-test): compact declared order, the "Wszystkie" tab's
  // held-goods-fullest-first view, or a category tab with held goods bubbled up — see visibleStockRows.
  const rows = visibleStockRows(model.stock, layout.stockCompact, activeTab);
  const shown = rows.slice(0, layout.stockRows * 2);
  shown.forEach((row, i) => {
    const slot = slots[i];
    if (slot === undefined) return;
    // Icon, plate and amount all share the row's vertical centre so a row reads on one level: the icon box
    // is inset symmetrically (top+bottom) instead of top-anchored, and the amount centres in the plate.
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
    // The pile icon is drawn after the plate so a slightly oversized pile overlaps its edge, not clips.
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
 * The original tab-plate glyph (frame 170–177) drawn on each tab, index = details tab. The category
 * glyphs are reordered from the sheet's raw order so each gets the fitting one (identified by eye:
 * cutlery→food, house→building, hammer→tools, boots→crafted, weapon→military…); the leading
 * "Wszystkie" tab takes the set's remaining glyph so the whole strip is the one original art style.
 * The glyph semantics aren't decoded, so this pairing is a named approximation; the hover tooltip
 * carries the authoritative name either way.
 */
const STOCK_TAB_GLYPH: readonly (number | undefined)[] = [
  GUI_FRAME.stock_tab_0 + 7, // 0 Wszystkie — the assorted-goods pile (reads as "everything")
  GUI_FRAME.stock_tab_0 + 2, // 1 Żywność — cutlery
  guiFrameIndex('resource_icon_water_drop'), // 2 Napoje — water drop (the tab set has no drink glyph)
  GUI_FRAME.stock_tab_0 + 4, // 3 Surowce — (unread)
  GUI_FRAME.stock_tab_0 + 1, // 4 Budulec — house
  GUI_FRAME.stock_tab_0 + 0, // 5 Narzędzia — hammer
  GUI_FRAME.stock_tab_0 + 5, // 6 Wyroby — boots
  GUI_FRAME.stock_tab_0 + 6, // 7 Wojsko — weapon
  GUI_FRAME.stock_tab_0 + 3, // 8 Inne — the set's remaining glyph (shears)
];

/**
 * The stock window's tabs — the "Wszystkie" (held goods, fullest first) tab then the eight categories —
 * justified across the body width (whether the original spreads or packs them flush is unread — a guess
 * alongside the per-tab categories, pending a human pass). Each tab bob carries its own plate plus a
 * glyph, drawn through the `bg_invert` palette as bright cream line-art on a recessed plate (a named
 * legibility choice, not verified to be the original's tab palette). Clicking a tab filters the stock
 * list (see `stock-tabs.ts` and `panel.ts`); the active tab carries a lime underline (the name row's
 * selected-strip look) so the current view reads at a glance.
 */
function drawStockTabs(chrome: Chrome, rects: readonly Rect[], activeTab: number, s: number): void {
  rects.forEach((r, i) => {
    // The original cream line-art glyph, reordered onto the fitting category tab, over a wooden plate (active
    // brighter, inactive dimmed) instead of the flat grey recessed rectangle.
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
