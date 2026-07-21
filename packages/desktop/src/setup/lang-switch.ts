import { currentLocale, LOCALE_CODES, LOCALES, type Locale, messages } from '../i18n/index.js';
import { el } from './dom.js';

/**
 * The header's flag buttons. The installer ships before any game content exists, so the language
 * choice has to live on the page itself rather than behind the native menu.
 */

export interface LangSwitchView {
  /** Re-label the flags and mark the active one for the current locale. */
  applyLabels(): void;
}

export function createLangSwitch(onPick: (locale: Locale) => void): LangSwitchView {
  const root = el('lang-switch');
  // Each button remembers its locale, so re-labelling needs no id lookup.
  const buttons = LOCALE_CODES.map((locale) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-button';
    button.textContent = LOCALES[locale].flag;
    button.addEventListener('click', () => onPick(locale));
    root.append(button);
    return { locale, button };
  });

  return {
    applyLabels(): void {
      const copy = messages().setup.language;
      for (const { locale, button } of buttons) {
        const label = copy[LOCALES[locale].labelKey];
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(currentLocale() === locale));
      }
    },
  };
}
