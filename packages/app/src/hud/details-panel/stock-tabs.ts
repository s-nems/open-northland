import { STOCK_TAB_COUNT } from '../../content/gui-atlas-map.js';
import { messages } from '../../i18n/index.js';
import type { Rect } from '../geometry.js';
import { stockTabLabels } from '../good-categories.js';

/** The stock tabs' native plate width - must track atlas frames 170–177 (decoded 32×18 plates). */
const STOCK_TAB_W = 32;

/**
 * The details-panel Magazyn's leading "Wszystkie" tab, listing held goods across every category; the
 * category tabs follow at details-tab index `category + 1`.
 */
export const ALL_STOCK_TAB = 0;
/** The "Wszystkie" tab plus the eight categories. */
export const DETAILS_STOCK_TAB_COUNT = STOCK_TAB_COUNT + 1;

/** The tab names indexed by details tab: "Wszystkie" then the eight categories. */
export function detailsStockTabLabels(): readonly string[] {
  return [messages().hud.stockAllTab, ...stockTabLabels()];
}

/**
 * The Magazyn rows a stock body lists for the active details tab, in display order (the caller slices to
 * its grid). One shared source for the section's draw and the panel's hover hit-test, so a hovered slot
 * names exactly the drawn good.
 */
export function visibleStockRows<T extends { readonly category: number; readonly amount: number }>(
  rows: readonly T[],
  compact: boolean,
  activeTab: number,
): T[] {
  if (compact) return [...rows];
  if (activeTab === ALL_STOCK_TAB) {
    return rows.filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);
  }
  const category = activeTab - 1;
  return rows
    .filter((row) => row.category === category)
    .sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
}

/**
 * The tab-plate rects across the strip, the one geometry both the tab drawing and the pointer hit-test
 * consume. `count` defaults to the plain eight categories.
 */
export function stockTabRects(strip: Rect, s: number, count: number = STOCK_TAB_COUNT): Rect[] {
  const w = Math.round(STOCK_TAB_W * s);
  const gap = (strip.w - count * w) / Math.max(1, count - 1);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    rects.push({ x: strip.x + Math.round(i * (w + gap)), y: strip.y, w, h: strip.h });
  }
  return rects;
}
