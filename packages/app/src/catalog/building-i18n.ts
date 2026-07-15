import { currentLocale, type Locale, type Messages, messages } from '../i18n/index.js';
import { VIKING_BUILDINGS } from './buildings.js';

export type UiLang = Locale;

function localeFromCode(lang: string): Locale {
  return lang === 'eng' || lang === 'en' ? 'eng' : 'pol';
}

/** Resolve a catalog building id through the active hand-authored locale. */
export function localizedBuildingName(id: string, fallback: string, lang: string = currentLocale()): string {
  const names = messages(localeFromCode(lang)).building;
  return names[id as keyof Messages['building']] ?? fallback;
}

/** Catalog ids missing from a locale, used as a compile-time-adjacent drift guard in tests. */
export function untranslatedBuildingIds(lang: UiLang): readonly string[] {
  const names = messages(lang).building;
  return VIKING_BUILDINGS.filter((building) => names[building.id as keyof typeof names] === undefined).map(
    (building) => building.id,
  );
}
