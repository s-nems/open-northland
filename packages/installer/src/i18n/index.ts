import { en, type Messages } from './en.js';
import { pl } from './pl.js';

interface LocaleEntry {
  readonly messages: Messages;
  /** BCP-47 language tag, and the primary subtag this language claims in an OS preference list. */
  readonly tag: string;
  readonly flag: string;
  readonly labelKey: keyof Messages['setup']['language'];
}

/** In flag-button order. */
export const LOCALES = {
  pol: { messages: pl as Messages, tag: 'pl', flag: '🇵🇱', labelKey: 'polish' },
  eng: { messages: en as Messages, tag: 'en', flag: '🇬🇧', labelKey: 'english' },
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

/** The first shipped language in an OS preference list such as `["cs-CZ", "pl-PL"]`. */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const match = LOCALE_CODES.find((code) => LOCALES[code].tag === primary);
    if (match !== undefined) return match;
  }
  return DEFAULT_LOCALE;
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
