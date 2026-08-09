import type { BrowserWindow } from 'electron';
import { patchConfig } from './config.js';
import { currentLocale, LOCALE_CODES, LOCALES, type Locale, setActiveLocale } from './i18n/index.js';
import { isGamePage } from './protocol-routing.js';
import type { ShellPaths } from './shell-state.js';
import { buildAppMenu } from './window.js';

export function applyShellLocale(win: BrowserWindow, paths: ShellPaths, locale: Locale): void {
  setActiveLocale(locale);
  patchConfig(paths.configFile, { locale });
  // The native menu does not re-localize itself; rebuild it for the new language.
  buildAppMenu(win, paths.dataRoot.path);
}

/**
 * The language the loaded page reports through its `lang` attribute, which the web app writes
 * whenever it activates a locale. Asking the page beats re-deriving its choice: only it knows which
 * of the URL, its stored setting, and its own browser-language detection won.
 */
async function pageLocale(win: BrowserWindow): Promise<Locale | undefined> {
  try {
    const tag: unknown = await win.webContents.executeJavaScript('document.documentElement.lang');
    return LOCALE_CODES.find((code) => LOCALES[code].tag === tag);
  } catch {
    return undefined; // A window torn down mid-navigation has no language to report.
  }
}

/** The shell and the game share one language, so a change made in the game's settings lands here. */
export function watchGameLocale(win: BrowserWindow, paths: ShellPaths): void {
  const adopt = (url: string): void => {
    if (!isGamePage(url)) return;
    void pageLocale(win).then((locale) => {
      if (locale === undefined || locale === currentLocale()) return;
      applyShellLocale(win, paths, locale);
    });
  };
  // The settings screen and a menu-to-world launch both rewrite the URL in place; quitting to the
  // menu loads a fresh document.
  win.webContents.on('did-navigate-in-page', (_event, url) => adopt(url));
  win.webContents.on('did-finish-load', () => adopt(win.webContents.getURL()));
}
