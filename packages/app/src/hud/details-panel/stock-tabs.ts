import { STOCK_TAB_COUNT } from '../../content/gui-atlas-map.js';
import { messages } from '../../i18n/index.js';
import type { Rect } from '../geometry.js';
import { stockTabLabels } from '../good-categories.js';

/**
 * The details-panel Magazyn's category-tab strip: the plate geometry (shared by the drawer and the click
 * hit-test) and the row filtering a tab click applies. The good→category grouping itself is the HUD-shared
 * `hud/good-categories.ts`.
 */

/** The stock tabs' native plate width — must track atlas frames 170–177 (decoded 32×18 plates). */
const STOCK_TAB_W = 32;

/**
 * The details-panel Magazyn's leading "Wszystkie" tab: the held goods across every category, fullest
 * first, zeros hidden — so clicking a general store shows what is actually inside at a glance. The
 * category tabs follow at detail-tab index `category + 1`. Details-panel-only: the tool panel's goods
 * window keeps the plain eight categories.
 */
export const ALL_STOCK_TAB = 0;
/** The details-panel Magazyn's tab count: the "Wszystkie" tab + the eight categories. */
export const DETAILS_STOCK_TAB_COUNT = STOCK_TAB_COUNT + 1;

/** The details-panel Magazyn's tab names: "Wszystkie" then the eight categories (index = details tab). */
export function detailsStockTabLabels(): readonly string[] {
  return [messages().hud.stockAllTab, ...stockTabLabels()];
}

/**
 * The Magazyn rows a tabbed/compact stock body lists for the active details tab, in display order (the
 * caller slices to its grid). One shared source for the section's draw and the panel's hover hit-test, so
 * a hovered slot names exactly the drawn good:
 *  - compact store → every declared slot, declared order (stable while amounts change);
 *  - the "Wszystkie" tab → only held goods (`amount > 0`), fullest first (equal amounts keep declared
 *    order — Array.sort is stable);
 *  - a category tab → its category's slots, held goods bubbled above the fold (stable).
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
 * The tab-plate rects laid out across the strip — the one geometry both the tab drawing and the
 * pointer hit-test consume, so the drawn tab and the clicked tab are the same rect by construction.
 * `count` defaults to the plain eight categories; the details panel passes
 * {@link DETAILS_STOCK_TAB_COUNT} for its extra "Wszystkie" tab.
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
