import { isLocale, type Locale, resolveLocale } from '@open-northland/installer/i18n';

/** The installer language persisted per browser; the game keeps its own setting. */
const LOCALE_STORAGE_KEY = 'open-northland.web-locale';

/** The visitor's language: their stored choice, else what the browser asks for. One definition, so
 *  the boot, the shell state, the worker, and the game link cannot disagree. */
export function effectiveLocale(): Locale {
  // A browser with site data blocked throws on the property itself, and a language is never worth
  // failing the boot for: the shell has a worded message for blocked storage further along.
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(raw)) return raw;
  } catch {
    // fall through to the browser's languages
  }
  return resolveLocale(navigator.languages);
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice applies to this page either way; only remembering it is lost.
  }
}
