import { en, type Messages } from './en.js';
import { pl } from './pl.js';

const LOCALE_CODES = ['pol', 'eng'] as const;

export type Locale = (typeof LOCALE_CODES)[number];

/** The BCP-47 primary subtag each shipped catalog claims. */
const LOCALE_TAGS: Readonly<Record<Locale, string>> = { pol: 'pl', eng: 'en' };

/** Where a preferred language with no shipped catalog lands. */
const FALLBACK_LOCALE: Locale = 'eng';

const LOCALES: Readonly<Record<Locale, Messages>> = { pol: pl, eng: en };
let activeLocale: Locale | undefined;

export function isLocale(value: unknown): value is Locale {
  return LOCALE_CODES.some((code) => code === value);
}

/** The first shipped catalog claimed by `preferred` (BCP-47 tags, most wanted first). */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const match = LOCALE_CODES.find((code) => LOCALE_TAGS[code] === primary);
    if (match !== undefined) return match;
  }
  return FALLBACK_LOCALE;
}

/** The app is imported under Node in tests, where there is no navigator to ask. */
function preferredLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

/** The language a player with no stored and no explicit choice starts in. */
export function defaultLocale(): Locale {
  return resolveLocale(preferredLanguages());
}

/** Accepts either spelling, the locale code or the bare tag; anything else takes the default. */
export function localeParam(params: URLSearchParams): Locale {
  const value = params.get('lang')?.toLowerCase();
  return LOCALE_CODES.find((code) => code === value || LOCALE_TAGS[code] === value) ?? defaultLocale();
}

export function bcp47Tag(locale: Locale = currentLocale()): string {
  return LOCALE_TAGS[locale];
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = bcp47Tag(locale);
}

export function currentLocale(): Locale {
  return activeLocale ?? defaultLocale();
}

export function messages(locale: Locale = currentLocale()): Messages {
  return LOCALES[locale];
}

export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function professionLabel(key: keyof Messages['profession'], locale: Locale = currentLocale()): string {
  return messages(locale).profession[key];
}

export function categoryLabel(key: keyof Messages['category'], locale: Locale = currentLocale()): string {
  return messages(locale).category[key];
}

export function uiLabel(key: keyof Messages['hud'], locale: Locale = currentLocale()): string {
  const value = messages(locale).hud[key];
  return typeof value === 'string' ? value : key;
}

export type { Messages } from './en.js';
