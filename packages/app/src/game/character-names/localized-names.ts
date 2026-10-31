import { currentLocale, type Locale } from '../../i18n/index.js';

/**
 * The localized spellings of the personal names, by pool then the raw name the pool gives a settler.
 * The raw name stays the lockstep key and the fallback, so this table is display-only data a locale
 * may leave as sparse as it likes.
 */

export type LocalizedNames = ReadonlyMap<string, ReadonlyMap<string, string>>;

const byLocale = new Map<Locale, LocalizedNames>();

/** The localized names `locale` reads; an empty set takes them back out, so a reload can clear them. */
export function installLocalizedNames(locale: Locale, names: LocalizedNames): void {
  if (names.size === 0) byLocale.delete(locale);
  else byLocale.set(locale, names);
}

/** What the active locale calls the raw `name` of `pool`, or undefined to keep the raw name. A settler
 *  whose snapshot names no pool never has a localized spelling. */
export function localizedName(pool: string | undefined, name: string): string | undefined {
  return pool === undefined ? undefined : byLocale.get(currentLocale())?.get(pool)?.get(name);
}
