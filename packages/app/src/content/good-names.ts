import { type Locale, type Messages, messages } from '../i18n/index.js';
import { loadGoodsManifest } from './goods-gfx.js';

/**
 * Localized good display names from the pipeline's per-locale tables (`content/goods/manifest.json`
 * `names`), extracted from the game's own `text/<lang>/strings/gameobjects/goods.{ini,cif}` and selected
 * by the app-wide `?lang=` value. Authored names keep the UI complete in a bare checkout; extracted
 * content overrides them. Keyed by good string id, stable across the sandbox and the extracted IR.
 */

/** The locales the pipeline emits (see `GOOD_NAME_LOCALES` in the goods stage). Preference order for fallback. */
const GOOD_LOCALES = ['pl', 'en'] as const;
export type GoodLocale = (typeof GOOD_LOCALES)[number];

/** The good-table locale matching the app's default `pol` locale. */
const DEFAULT_GOOD_LOCALE: GoodLocale = 'pl';

/** Map the app-wide `?lang=pol|eng` value to the goods tables' `pl|en` codes. */
export function goodLocaleParam(params: URLSearchParams): GoodLocale {
  return params.get('lang') === 'eng' || params.get('lang') === 'en' ? 'en' : 'pl';
}

/**
 * The authored good names for a locale. They also cover the goods that exist only in the sandbox (no game
 * `[goodtype]`, so no string-table entry, e.g. `plank`), which have no faithful source: those are a named
 * approximation so a synthetic good still reads in-language.
 */
function localeMessages(locale: GoodLocale): Messages['goods'] {
  const appLocale: Locale = locale === 'pl' ? 'pol' : 'eng';
  return messages(appLocale).goods;
}

/** The per-locale extracted good-name tables from the shared goods manifest, or `{}` when the goods stage
 *  has not run. */
async function loadNameTables(): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> {
  return (await loadGoodsManifest())?.names ?? {};
}

/**
 * Build the good string id → display name map for a locale, applying the fallback chain
 * `<locale> extracted → authored → pl extracted → en extracted` per id, so a good missing from the chosen
 * language still shows a name rather than its raw id.
 */
export function resolveGoodNameMap(
  tables: Readonly<Record<string, Readonly<Record<string, string>>>>,
  locale: GoodLocale = DEFAULT_GOOD_LOCALE,
): ReadonlyMap<string, string> {
  const ids = new Set<string>();
  for (const table of Object.values(tables)) for (const id of Object.keys(table)) ids.add(id);
  const authored = localeMessages(locale);
  for (const id of Object.keys(authored)) ids.add(id);

  const out = new Map<string, string>();
  for (const id of ids) {
    const name =
      tables[locale]?.[id] ?? authored[id as keyof typeof authored] ?? tables.pl?.[id] ?? tables.en?.[id];
    if (name !== undefined) out.set(id, name);
  }
  return out;
}

/** Fetch the per-locale name tables (memoized) and resolve them for `locale` ({@link resolveGoodNameMap}). */
export async function loadGoodNameMap(
  locale: GoodLocale = DEFAULT_GOOD_LOCALE,
): Promise<ReadonlyMap<string, string>> {
  return resolveGoodNameMap(await loadNameTables(), locale);
}
