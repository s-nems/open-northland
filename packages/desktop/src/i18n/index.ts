import { en, type Messages } from './en.js';
import { pl } from './pl.js';

/**
 * The installer's i18n API — its own small catalog shared by the main process and the setup
 * renderer (both import this module; each process holds its own {@link activeLocale}). DOM access is
 * guarded so the Node main process can import it too. Mirrors the game's `packages/app/src/i18n`
 * conventions without sharing its browser-only runtime.
 */

export type Locale = 'eng' | 'pol';

const DEFAULT_LOCALE: Locale = 'eng';
const LOCALES: Readonly<Record<Locale, Messages>> = { eng: en, pol: pl };
let activeLocale: Locale = DEFAULT_LOCALE;

/** Every accepted locale, for validating a persisted or IPC-supplied value. */
export const LOCALE_CODES: readonly Locale[] = ['eng', 'pol'];

export function isLocale(value: unknown): value is Locale {
  return value === 'eng' || value === 'pol';
}

/** Map an OS/BCP-47 locale (Electron `app.getLocale()`, e.g. `"pl-PL"`) onto the two installer languages. */
export function resolveLocale(raw: string | undefined): Locale {
  return raw?.toLowerCase().startsWith('pl') ? 'pol' : DEFAULT_LOCALE;
}

/** BCP-47 tag for `toLocaleString` number formatting and the document `lang` attribute. */
export function localeTag(locale: Locale = activeLocale): 'en' | 'pl' {
  return locale === 'pol' ? 'pl' : 'en';
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = localeTag(locale);
}

export function currentLocale(): Locale {
  return activeLocale;
}

export function messages(locale: Locale = activeLocale): Messages {
  return LOCALES[locale];
}

/** Fill `{placeholder}` slots from `values`; an unknown placeholder is left verbatim. */
export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export type { Messages } from './en.js';
