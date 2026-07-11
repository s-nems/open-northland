import { VIKING_BUILDINGS } from './buildings.js';

/**
 * Localized building display names — the i18n seam for the build picker (and any HUD surface that names a
 * building). Keyed by the catalog's stable `id`, so it can't drift from a typeId renumber.
 *
 * Source basis: our own POLISH translations. No localized, player-facing building-name table exists in the
 * decoded data — `content/gui/strings/<lang>.json` carries only window/section labels (`housewindow`,
 * `miscwindow`, …), not per-building names — so the Polish names below are ours. They mirror the English
 * `label` in `catalog/buildings.ts`, which is itself source-derived: each `[GfxHouse]` in the readable mod
 * source `DataCnmd/budynki12/houses/houses.ini` carries an English `EditName` ("viking bakery", "viking
 * mill", …) matching the catalog 1:1 — a dev-facing editor name, not carried into the decoded content.
 * These are display strings, never a lookup key. If a localized name table is ever extracted, prefer it.
 *
 * i18n shape: one map per language. Today only Polish is authored; every other language falls back to the
 * English catalog `label` (the `eng` "table" is that label, so it needs no duplicate map here). A new
 * language is a new entry in {@link BUILDING_NAMES} — no call-site change.
 */

/** UI languages the game can localize to (the original's four locales). Only `pol` adds names here; if a
 *  canonical locale union is ever introduced elsewhere, derive this from it rather than restating it. */
export type UiLang = 'pol' | 'eng' | 'ger' | 'rus';

/**
 * Clean-room Polish building names, keyed by the catalog `id`. Level suffixes are 1-based for the player
 * (`(poziom 1)`, `(poziom 2)`, …) even though the underlying ids stay 0-indexed (`stock_00` = "poziom 1");
 * they mirror the English labels' `(level N)` in `catalog/buildings.ts`. The "defence wall" slot
 * (`work_pottery_02`) names its real wall function, not the pipeline's pottery id.
 */
const BUILDING_NAMES_PL: Readonly<Record<string, string>> = {
  headquarters: 'Kwatera Główna',
  home_level_00: 'Dom (poziom 1)',
  home_level_01: 'Dom (poziom 2)',
  home_level_02: 'Dom (poziom 3)',
  home_level_03: 'Dom (poziom 4)',
  home_level_04: 'Dom (poziom 5)',
  stock_00: 'Magazyn (poziom 1)',
  stock_01: 'Magazyn (poziom 2)',
  stock_02: 'Magazyn (poziom 3)',
  work_well_00: 'Studnia',
  work_hive_00: 'Pasieka',
  // 'Farma' matches the original's own display name (`Data/text/.../houses.ini` `stringn 12 "Farm"`);
  // the earlier 'Farma zbożowa' over-specified it (user-requested rename).
  work_farm_00: 'Farma',
  work_mill_00: 'Młyn',
  work_bakery_00: 'Piekarnia (poziom 1)',
  work_bakery_01: 'Piekarnia (poziom 2)',
  work_brewery: 'Browar',
  work_animal_farm: 'Hodowla zwierząt',
  work_sewery_00: 'Krawiec (poziom 1)',
  work_sewery_01: 'Krawiec (poziom 2)',
  work_pottery_00: 'Garncarnia (poziom 1)',
  work_pottery_01: 'Garncarnia (poziom 2)',
  work_pottery_02: 'Mur obronny',
  work_joinery_00: 'Stolarnia (poziom 1)',
  work_joinery_01: 'Stolarnia (poziom 2)',
  work_joinery_02: 'Stolarnia (poziom 3)',
  work_joinery_03: 'Stolarnia (poziom 4)',
  work_armory_00: 'Zbrojownia (poziom 1)',
  work_armory_01: 'Zbrojownia (poziom 2)',
  work_mason_hut_00: 'Chata kamieniarza (poziom 1)',
  work_mason_hut_01: 'Chata kamieniarza (poziom 2)',
  work_smithy_00: 'Kuźnia (poziom 1)',
  work_smithy_01: 'Kuźnia (poziom 2)',
  work_coin_mint: 'Mennica',
  work_herb_hut: 'Chata zielarza',
  work_druid_00: 'Chata druida (poziom 1)',
  work_druid_01: 'Chata druida (poziom 2)',
  work_temple: 'Świątynia',
  school: 'Szkoła',
  barracks: 'Koszary',
  tower_00: 'Wieża strażnicza (poziom 1)',
  tower_01: 'Wieża strażnicza (poziom 2)',
};

/** Per-language name tables. A missing language (or missing id) falls back to the English catalog label. */
const BUILDING_NAMES: Partial<Record<UiLang, Readonly<Record<string, string>>>> = {
  pol: BUILDING_NAMES_PL,
};

/**
 * The building's display name in `lang`: the localized name when one is authored, else `englishLabel`
 * (the `catalog/buildings.ts` clean-room English name) — so an unlocalized language or a missing id still
 * shows a sensible name instead of a raw id.
 */
export function localizedBuildingName(id: string, englishLabel: string, lang: string): string {
  return BUILDING_NAMES[lang as UiLang]?.[id] ?? englishLabel;
}

/** The building ids that lack a Polish name — empty when the table is complete (the drift-guard for tests). */
export function untranslatedBuildingIds(lang: UiLang): readonly string[] {
  const table = BUILDING_NAMES[lang];
  if (table === undefined) return VIKING_BUILDINGS.map((b) => b.id);
  return VIKING_BUILDINGS.filter((b) => table[b.id] === undefined).map((b) => b.id);
}
