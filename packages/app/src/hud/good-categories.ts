import { messages } from '../i18n/index.js';

/**
 * The good→stock-category grouping and the category names — shared by every HUD window that groups goods
 * into the original's eight tabs (the details panel's Magazyn, the tool panel's goods window).
 *
 * The mapping is a NAMED APPROXIMATION. The original filters its goods across these eight tabs, but that
 * mapping is not in the extracted data — no 8-way stock-tab category field exists on goods
 * (`goodtypes.ini` and ir.json carry only production flags and armor/weapon sub-types); it is a hardcoded
 * engine/GUI feature. The tab-plate glyphs are also still unread (montage guesses), so which glyph-tab a
 * category maps to is provisional too; both the categories below and their tab order are meant to be
 * corrected once the glyphs are read or a real category source is found. The map is keyed by the good's
 * stable string id, so it serves the sandbox and the real ir.json good sets identically.
 */

/** The misc/"Inne" tab a good with no explicit category falls into. */
const DEFAULT_TAB = 7;

/**
 * The eight category tabs' display names (index = tab), shown as a hover tooltip since the glyph plates
 * are unread (see file header). Polish (the default UI language); a future locale pass can localize these.
 */
export function stockTabLabels(): readonly string[] {
  return messages().hud.stockTabs;
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
