import { fetchJsonOrNull } from './net.js';

/**
 * Localized good DISPLAY names — the loadable seam for the pipeline's per-locale good-name tables
 * (`content/goods/manifest.json` `names`: locale → good STRING id → name, extracted from the game's own
 * `text/<lang>/strings/gameobjects/goods.{ini,cif}`). The whole catalog reads in the player's language, and
 * adding/switching a language is a data + `?locale=` change, not a code edit. A bare checkout (no `content/`)
 * yields an empty map and callers fall back to their built-in English labels / the machine id.
 *
 * Keyed by good STRING id (not typeId), stable across the sandbox and the extracted IR — the same key the
 * icon manifest uses — so one lookup serves every scene and both good-id namespaces.
 */

/** The locales the pipeline emits (see `GOOD_NAME_LOCALES` in the goods stage). Preference order for fallback. */
export const GOOD_LOCALES = ['pl', 'en', 'de'] as const;
export type GoodLocale = (typeof GOOD_LOCALES)[number];

/** The default UI language — Polish (the `culturesnation` mod's audience). Overridable via `?locale=`. */
export const DEFAULT_GOOD_LOCALE: GoodLocale = 'pl';

/** Parse a `?locale=` value to a known {@link GoodLocale}, defaulting to {@link DEFAULT_GOOD_LOCALE}. */
export function goodLocaleParam(params: URLSearchParams): GoodLocale {
  const raw = params.get('locale');
  return (GOOD_LOCALES as readonly string[]).includes(raw ?? '') ? (raw as GoodLocale) : DEFAULT_GOOD_LOCALE;
}

/**
 * Names for goods that exist ONLY in the sandbox (no game `[goodtype]`, so no string-table entry): the demo
 * `plank` the joinery slice produces. Kept here (not in the pipeline manifest) because they have no faithful
 * source — a NAMED APPROXIMATION so the synthetic good reads in-language too. `plank` = sawn `wood`.
 */
const SYNTHETIC_GOOD_NAMES: Record<string, Record<GoodLocale, string>> = {
  // The joinery slice's output, drawn as a felled LOG (see resource-gfx) — named "log" to match its graphic.
  plank: { pl: 'Kłoda', en: 'Log', de: 'Baumstamm' },
};

const GOODS_MANIFEST_URL = '/goods/manifest.json';

interface NamesManifest {
  readonly names?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

let namesOnce: Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> | null = null;

/** Fetch the per-locale good-name tables once (memoized), or `{}` when the goods stage hasn't run. */
async function loadNameTables(): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> {
  namesOnce ??= fetchJsonOrNull<NamesManifest>(GOODS_MANIFEST_URL).then((m) => m?.names ?? {});
  return namesOnce;
}

/**
 * Build the `good STRING id → display name` map for a locale (pure), applying the fallback chain
 * `<locale> → pl → en` per id plus the synthetic overlay, so a good missing from the chosen language still
 * shows a name rather than its raw id. Empty when `tables` is empty (bare checkout). Split from the fetch so
 * the fallback rule is unit-tested without the network.
 */
export function resolveGoodNameMap(
  tables: Readonly<Record<string, Readonly<Record<string, string>>>>,
  locale: GoodLocale = DEFAULT_GOOD_LOCALE,
): ReadonlyMap<string, string> {
  const ids = new Set<string>();
  for (const table of Object.values(tables)) for (const id of Object.keys(table)) ids.add(id);
  for (const id of Object.keys(SYNTHETIC_GOOD_NAMES)) ids.add(id);

  const out = new Map<string, string>();
  for (const id of ids) {
    const name =
      tables[locale]?.[id] ??
      tables.pl?.[id] ??
      tables.en?.[id] ??
      SYNTHETIC_GOOD_NAMES[id]?.[locale] ??
      SYNTHETIC_GOOD_NAMES[id]?.pl;
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
