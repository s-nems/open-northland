import { type MapStrings, type MapText, type MapTextLanguage, textReadingOrder } from '@open-northland/data';

/** A map's name, description or seat name in `lang`, else in the first shipped language that has it. */
export function localizedMapText(text: MapText | undefined, lang: MapTextLanguage): string | undefined {
  if (text === undefined) return undefined;
  for (const code of textReadingOrder(lang)) {
    const value = text[code];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The value {@link localizedMapText} answers, with the language it read in. */
export interface LocalizedMapString {
  readonly text: string;
  /** The language the text reads in, or null when `lang` itself carries it. */
  readonly lang: MapTextLanguage | null;
}

/** {@link localizedMapText} with the language the winning table reads in, for foreign-text handling. */
export function localizedMapTextWithLang(
  text: MapText | undefined,
  lang: MapTextLanguage,
): LocalizedMapString | undefined {
  if (text === undefined) return undefined;
  for (const code of textReadingOrder(lang)) {
    const value = text[code];
    if (value !== undefined) return { text: value, lang: code === lang ? null : code };
  }
  return undefined;
}

/**
 * A map's own strings by id (`CreateTribute`'s description, `SetHumanName`, the info lines), read in
 * {@link textReadingOrder}: `lang` first, then the languages its readers fall back to. Undefined for an
 * id no table carries.
 */
export function mapStringLookup(
  strings: MapStrings | null,
  lang: MapTextLanguage,
): (stringId: number) => string | undefined {
  const lookup = mapStringLookupWithLang(strings, lang);
  return (stringId) => lookup(stringId)?.text;
}

/** {@link mapStringLookup} with the language each string read in, for foreign-text handling. */
export function mapStringLookupWithLang(
  strings: MapStrings | null,
  lang: MapTextLanguage,
): (stringId: number) => LocalizedMapString | undefined {
  if (strings === null) return () => undefined;
  const tables: {
    readonly table: Readonly<Record<string, string>>;
    readonly foreign: MapTextLanguage | null;
  }[] = [];
  for (const code of textReadingOrder(lang)) {
    const table = strings[code];
    if (table !== undefined) tables.push({ table, foreign: code === lang ? null : code });
  }
  return (stringId) => {
    const key = String(stringId);
    for (const { table, foreign } of tables) {
      const text = table[key];
      if (text !== undefined) return { text, lang: foreign };
    }
    return undefined;
  };
}
