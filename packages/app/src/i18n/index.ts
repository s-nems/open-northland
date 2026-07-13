import { en, type Messages } from './en.js';
import { pl } from './pl.js';

export type Locale = 'pol' | 'eng';

export const DEFAULT_LOCALE: Locale = 'pol';

const LOCALES: Readonly<Record<Locale, Messages>> = { pol: pl, eng: en };
let activeLocale: Locale = DEFAULT_LOCALE;

export function localeParam(params: URLSearchParams): Locale {
  const value = params.get('lang');
  if (value === 'eng' || value === 'en') return 'eng';
  if (value === 'pol' || value === 'pl') return 'pol';
  return DEFAULT_LOCALE;
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale === 'pol' ? 'pl' : 'en';
}

export function currentLocale(): Locale {
  return activeLocale;
}

export function messages(locale: Locale = activeLocale): Messages {
  return LOCALES[locale];
}

export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function professionLabel(key: keyof Messages['profession'], locale: Locale = activeLocale): string {
  return messages(locale).profession[key];
}

export function categoryLabel(key: keyof Messages['category'], locale: Locale = activeLocale): string {
  return messages(locale).category[key];
}

export function uiLabel(key: keyof Messages['hud'], locale: Locale = activeLocale): string {
  const value = messages(locale).hud[key];
  return typeof value === 'string' ? value : key;
}

export type { Messages } from './en.js';
