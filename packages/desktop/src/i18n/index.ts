import { en, type Messages } from './en.js';
import { pl } from './pl.js';

interface LocaleEntry {
  readonly messages: Messages;
  /** BCP-47 language tag. */
  readonly tag: string;
  /** Lowercased OS-locale prefix this language claims; the first entry whose prefix matches wins. */
  readonly osPrefix: string;
  readonly flag: string;
  readonly labelKey: keyof Messages['setup']['language'];
}

/** In flag-button order. */
export const LOCALES = {
  pol: { messages: pl as Messages, tag: 'pl', osPrefix: 'pl', flag: '🇵🇱', labelKey: 'polish' },
  eng: { messages: en as Messages, tag: 'en', osPrefix: 'en', flag: '🇬🇧', labelKey: 'english' },
} as const satisfies Record<string, LocaleEntry>;

export type Locale = keyof typeof LOCALES;
export type LocaleTag = (typeof LOCALES)[Locale]['tag'];

const DEFAULT_LOCALE: Locale = 'eng';
/** The main process and the setup renderer each hold their own copy, synced over IPC. */
let activeLocale: Locale = DEFAULT_LOCALE;

export const LOCALE_CODES = Object.keys(LOCALES) as readonly Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value);
}

/** Maps an OS locale tag such as `"pl-PL"` onto a shipped language. */
export function resolveLocale(raw: string | undefined): Locale {
  const lower = raw?.toLowerCase();
  if (lower === undefined) return DEFAULT_LOCALE;
  return LOCALE_CODES.find((code) => lower.startsWith(LOCALES[code].osPrefix)) ?? DEFAULT_LOCALE;
}

export function localeTag(locale: Locale = activeLocale): LocaleTag {
  return LOCALES[locale].tag;
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = localeTag(locale);
}

export function currentLocale(): Locale {
  return activeLocale;
}

export function messages(locale: Locale = activeLocale): Messages {
  return LOCALES[locale].messages;
}

/** Fill `{placeholder}` slots from `values`; an unknown placeholder is left verbatim. */
export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export type { Messages } from './en.js';
