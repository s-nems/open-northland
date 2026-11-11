/**
 * The one language registry. A source language is one the data pack and a map archive can ship text
 * in (`text/<code>/`, `Data/text/<code>/`) and that the repository never commits original text of; an
 * overlay language may overlay anything through the repository's `translations/<code>/` overlays. The
 * order is the text fallback order: a text missing in the reader's language falls back along it, and the
 * culturesnation mod is Polish-authored.
 */
export const SOURCE_LANGUAGES = ['pol', 'eng', 'ger', 'rus'] as const;
export const OVERLAY_LANGUAGES = ['ita', 'chs', 'cht'] as const;
export const LANGUAGES = [...SOURCE_LANGUAGES, ...OVERLAY_LANGUAGES] as const;
/** The languages the data pack may ship text in: the source languages and Italian, an overlay language
 *  whose official text only the pack carries. Shipped text wins over an overlay of the same language. */
export const PACK_LANGUAGES = [...SOURCE_LANGUAGES, 'ita'] as const;

export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];
export type OverlayLanguage = (typeof OVERLAY_LANGUAGES)[number];
export type PackLanguage = (typeof PACK_LANGUAGES)[number];
export type Language = (typeof LANGUAGES)[number];

export interface LanguageInfo {
  readonly code: Language;
  /** The BCP-47 tag the UI claims for it (`lang` attributes, `navigator.languages` matching). */
  readonly tag: string;
  /** Languages read before the registry order when a text lacks this one: a Chinese or Italian reader
   *  is more likely to read English than the mod's Polish. */
  readonly fallbacks?: readonly Language[];
}

export const LANGUAGE_INFO: Readonly<Record<Language, LanguageInfo>> = {
  pol: { code: 'pol', tag: 'pl' },
  eng: { code: 'eng', tag: 'en' },
  ger: { code: 'ger', tag: 'de' },
  rus: { code: 'rus', tag: 'ru' },
  ita: { code: 'ita', tag: 'it', fallbacks: ['eng'] },
  chs: { code: 'chs', tag: 'zh-Hans', fallbacks: ['eng'] },
  cht: { code: 'cht', tag: 'zh-Hant', fallbacks: ['chs', 'eng'] },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return typeof value === 'string' && (SOURCE_LANGUAGES as readonly string[]).includes(value);
}

export function isPackLanguage(value: unknown): value is PackLanguage {
  return typeof value === 'string' && (PACK_LANGUAGES as readonly string[]).includes(value);
}

/** The languages a reader of `lang` reads a text in, most preferred first: `lang`, its own fallbacks,
 *  then every language in registry order. */
export function textReadingOrder(lang: Language): readonly Language[] {
  return [...new Set([lang, ...(LANGUAGE_INFO[lang].fallbacks ?? []), ...LANGUAGES])];
}
