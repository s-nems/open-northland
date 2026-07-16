import { STOCK_TAB_COUNT } from '../../content/gui-atlas-map.js';
import { messages } from '../../i18n/index.js';
import type { Rect } from '../geometry.js';

/**
 * The stock window's eight category tabs: geometry (shared by the drawer and the click hit-test) plus the
 * good→tab grouping that lets a click filter the Magazyn list to one category.
 *
 * The good→category mapping is a NAMED APPROXIMATION. The original filters its goods across these eight
 * tabs, but that mapping is not in the extracted data — no 8-way stock-tab category field exists on goods
 * (`goodtypes.ini` and ir.json carry only production flags and armor/weapon sub-types); it is a hardcoded
 * engine/GUI feature. The tab-plate glyphs are also still unread (montage guesses), so which glyph-tab a
 * category maps to is provisional too; both the categories below and their tab order are meant to be
 * corrected once the glyphs are read or a real category source is found. The map is keyed by the good's
 * stable string id, so it serves the sandbox and the real ir.json good sets identically.
 */

/** The stock tabs' native plate width — must track atlas frames 170–177 (decoded 32×18 plates). */
const STOCK_TAB_W = 32;

/** The misc/"Inne" tab a good with no explicit category falls into. */
const DEFAULT_TAB = 7;

/**
 * The details-panel Magazyn's leading "Wszystkie" tab: the held goods across every category, fullest
 * first, zeros hidden — so clicking a general store shows what is actually inside at a glance. The
 * category tabs follow at detail-tab index `category + 1`. Details-panel-only: the tool panel's goods
 * window keeps the plain eight categories.
 */
export const ALL_STOCK_TAB = 0;
/** The details-panel Magazyn's tab count: the "Wszystkie" tab + the eight categories. */
export const DETAILS_STOCK_TAB_COUNT = STOCK_TAB_COUNT + 1;

/**
 * The eight category tabs' display names (index = tab), shown as a hover tooltip since the glyph plates
 * are unread (see file header). Polish (the default UI language); a future locale pass can localize these.
 */
export function stockTabLabels(): readonly string[] {
  return messages().hud.stockTabs;
}

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

/** Good string id → tab index (0–7). Provisional grouping — see the file header. */
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
 * The tab-plate rects laid out across the strip — the one geometry both {@link drawStockTabs} and the
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
