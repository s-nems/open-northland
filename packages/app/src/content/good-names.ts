import { type Locale, type Messages, messages } from '../i18n/index.js';
import { fetchJsonOrNull } from './net.js';

/**
 * Localized good display names — the loadable seam for the pipeline's per-locale good-name tables
 * (`content/goods/manifest.json` `names`: locale → good string id → name, extracted from the game's own
 * `text/<lang>/strings/gameobjects/goods.{ini,cif}`, following the app-wide `?lang=` value). Authored names
 * keep the UI complete in a bare checkout; extracted content overrides them when the local pipeline output
 * is available.
 *
 * Keyed by good string id (not typeId), stable across the sandbox and the extracted IR — the same key the
 * icon manifest uses — so one lookup serves every scene and both good-id namespaces.
 */

/** The locales the pipeline emits (see `GOOD_NAME_LOCALES` in the goods stage). Preference order for fallback. */
export const GOOD_LOCALES = ['pl', 'en'] as const;
export type GoodLocale = (typeof GOOD_LOCALES)[number];

/** The good-table locale matching the app's default `pol` locale. */
export const DEFAULT_GOOD_LOCALE: GoodLocale = 'pl';

/** Map the app-wide `?lang=pol|eng` value to the goods tables' `pl|en` codes. */
export function goodLocaleParam(params: URLSearchParams): GoodLocale {
  return params.get('lang') === 'eng' || params.get('lang') === 'en' ? 'en' : 'pl';
}

/**
 * Names for goods that exist only in the sandbox (no game `[goodtype]`, so no string-table entry): the demo
 * `plank` the joinery slice produces. Kept here (not in the pipeline manifest) because they have no faithful
 * source — a NAMED APPROXIMATION so the synthetic good reads in-language too. `plank` = sawn `wood`.
 */
function localeMessages(locale: GoodLocale): Messages['goods'] {
  const appLocale: Locale = locale === 'pl' ? 'pol' : 'eng';
  return messages(appLocale).goods;
}

const GOODS_MANIFEST_URL = '/goods/manifest.json';

interface NamesManifest {
  readonly names?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

let namesOnce: Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> | null = null;

/** Fetch the per-locale extracted good-name tables once, or `{}` when the goods stage has not run. */
async function loadNameTables(): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> {
  namesOnce ??= fetchJsonOrNull<NamesManifest>(GOODS_MANIFEST_URL).then((m) => m?.names ?? {});
  return namesOnce;
}

/**
 * Build the `good STRING id → display name` map for a locale (pure), applying the fallback chain
 * `<locale> extracted → authored → pl extracted → en extracted` per id, so a good missing from the
 * chosen language still shows a name rather than its raw id. Authored names also cover a bare checkout.
 * Split from the fetch so the fallback rule is unit-tested without the network.
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
