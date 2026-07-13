import { STOCK_TAB_COUNT } from '../../content/gui-atlas-map.js';
import { messages } from '../../i18n/index.js';
import type { Rect } from '../geometry.js';

/**
 * The stock window's eight category tabs: geometry (shared by the drawer and the click hit-test) plus the
 * good→tab grouping that lets a click filter the Magazyn list to one category.
 *
 * The good→category mapping is a NAMED APPROXIMATION. The original's stock window filters its goods across
 * these eight tabs, but that mapping is NOT in the extracted data — no 8-way stock-tab category field exists
 * on goods (`goodtypes.ini` and ir.json carry only production flags and armor/weapon sub-types, not the tab
 * grouping); it is a hardcoded engine/GUI feature. On
 * top of that the tab-plate GLYPHS are still unread (montage guesses, pending the plan's step-3 human pass),
 * so WHICH glyph-tab a category maps to is provisional too. Both the categories below and their tab order are
 * meant to be corrected once the glyphs are read or a real category source is found. The map is keyed by the
 * good's STABLE string id, so it serves the sandbox and the real ir.json good sets identically.
 */

/** The stock tabs' native plate width — must track atlas frames 170–177 (decoded 32×18 plates). */
const STOCK_TAB_W = 32;

/** The misc/"Inne" tab a good with no explicit category falls into. */
const DEFAULT_TAB = 7;

/**
 * The eight category tabs' display names (index = tab), shown as a hover tooltip — the tab-plate GLYPHS are
 * unread original art (montage guesses, see the file header), so the cryptic icon alone doesn't say what a
 * tab holds; the tooltip names it. Polish (the default UI language); a future locale pass can localize these.
 */
export function stockTabLabels(): readonly string[] {
  return messages().hud.stockTabs;
}

/** Good STRING id → tab index (0–7). Provisional grouping — see the file header. */
const CATEGORY_BY_GOOD: Readonly<Record<string, number>> = {
  // 0 — Żywność (food)
  food_simple: 0,
  food_extra: 0,
  bread: 0,
  meat: 0,
  candy: 0,
  mushroom: 0,
  wheat: 0,
  honey: 0,
  flour: 0,
  // 1 — Napoje (drink / consumable liquids)
  water: 1,
  mead: 1,
  holy_oil: 1,
  // 2 — Surowce (raw materials)
  wood: 2,
  stone: 2,
  mud: 2,
  iron: 2,
  gold: 2,
  wool: 2,
  leather: 2,
  herb: 2,
  // 3 — Budulec (building materials)
  plank: 3,
  brick: 3,
  tile: 3,
  pillar: 3,
  ornament: 3,
  // 4 — Narzędzia (tools)
  tool_wooden: 4,
  tool_iron: 4,
  // 5 — Wyroby (crafted household goods)
  crockery: 5,
  furniture: 5,
  shoes: 5,
  // 6 — Wojsko (weapons + armor)
  bow_short: 6,
  bow_long: 6,
  spear_wooden: 6,
  spear_iron: 6,
  sword_shord: 6,
  sword_long: 6,
  armor_wool: 6,
  armor_leather: 6,
  armor_chain: 6,
  armor_plate: 6,
  // 7 — Inne (currency, potions, amulets, animals, vehicles, special) falls through DEFAULT_TAB
  coin: 7,
};

/** The stock tab a good belongs to, by its string id (misc/"Inne" tab when unknown). */
export function goodCategoryTab(goodId: string | undefined): number {
  if (goodId === undefined) return DEFAULT_TAB;
  return CATEGORY_BY_GOOD[goodId] ?? DEFAULT_TAB;
}

/**
 * The eight tab-plate rects laid out across the strip — the ONE geometry both {@link drawStockTabs} and the
 * pointer hit-test consume, so the drawn tab and the clicked tab are the same rect by construction.
 */
export function stockTabRects(strip: Rect, s: number): Rect[] {
  const w = Math.round(STOCK_TAB_W * s);
  const gap = (strip.w - STOCK_TAB_COUNT * w) / Math.max(1, STOCK_TAB_COUNT - 1);
  const rects: Rect[] = [];
  for (let i = 0; i < STOCK_TAB_COUNT; i++) {
    rects.push({ x: strip.x + Math.round(i * (w + gap)), y: strip.y, w, h: strip.h });
  }
  return rects;
}
