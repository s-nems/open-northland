import { isLocale, type Locale, resolveLocale } from '@open-northland/installer/i18n';

/** The installer language persisted per browser; the game keeps its own setting. */
const LOCALE_STORAGE_KEY = 'open-northland.web-locale';

/** The visitor's language: their stored choice, else what the browser asks for. One definition, so
 *  the boot, the shell state, the worker, and the game link cannot disagree. */
export function effectiveLocale(): Locale {
  const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(raw) ? raw : resolveLocale(navigator.languages);
}

export function storeLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
