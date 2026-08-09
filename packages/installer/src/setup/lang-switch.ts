import { currentLocale, LOCALE_CODES, LOCALES, type Locale, messages } from '../i18n/index.js';
import { el } from './dom.js';

/**
 * The installer runs before any game content exists, so its language choice lives on the page
 * itself rather than behind the native menu.
 */

export interface LangSwitchView {
  applyLabels(): void;
}

export function createLangSwitch(onPick: (locale: Locale) => void): LangSwitchView {
  const root = el('lang-switch');
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
