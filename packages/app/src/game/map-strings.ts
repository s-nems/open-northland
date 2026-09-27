import {
  MAP_TEXT_LANGUAGES,
  type MapStrings,
  type MapText,
  type MapTextLanguage,
} from '@open-northland/data';

/** `lang` first, then the shipped languages in their preference order, so a map authored in one
 *  language still reads under another. */
function readingOrder(lang: MapTextLanguage): readonly MapTextLanguage[] {
  return [...new Set([lang, ...MAP_TEXT_LANGUAGES])];
}

/** A map's name, description or seat name in `lang`, else in the first shipped language that has it. */
export function localizedMapText(text: MapText | undefined, lang: MapTextLanguage): string | undefined {
  if (text === undefined) return undefined;
  for (const code of readingOrder(lang)) {
    const value = text[code];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * A map's own strings by id (`CreateTribute`'s description, `SetHumanName`, the info lines), read in
 * {@link readingOrder}. Undefined for an id no table carries.
 */
export function mapStringLookup(
  strings: MapStrings | null,
  lang: MapTextLanguage,
): (stringId: number) => string | undefined {
  if (strings === null) return () => undefined;
  const tables: Readonly<Record<string, string>>[] = [];
  for (const code of readingOrder(lang)) {
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
