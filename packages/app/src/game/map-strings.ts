import { MAP_TEXT_LANGUAGES, type MapStrings, type MapTextLanguage } from '@open-northland/data';

/**
 * A map's own strings by id (`CreateTribute`'s description, `SetHumanName`, the info lines): the
 * table for `lang` first, then the shipped languages in their preference order, so a map authored in
 * one language still reads under another. Undefined for an id no table carries.
 */
export function mapStringLookup(
  strings: MapStrings | null,
  lang: MapTextLanguage,
): (stringId: number) => string | undefined {
  if (strings === null) return () => undefined;
  const tables: Readonly<Record<string, string>>[] = [];
  for (const code of new Set([lang, ...MAP_TEXT_LANGUAGES])) {
    const table = strings[code];
    if (table !== undefined) tables.push(table);
  }
  return (stringId) => {
    const key = String(stringId);
    for (const table of tables) {
      const text = table[key];
      if (text !== undefined) return text;
    }
    return undefined;
  };
}
