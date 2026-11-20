import { GAME_VERSION } from '../build-version.js';
import { currentLocale, type Locale, type Messages, messages } from '../i18n/index.js';
import { servedByBrowser } from '../view/platform/host.js';

/** The game as a version gap words it: its release, and whether a reload can bring the new one. */
export interface RunningGame {
  readonly version: string;
  /** A web page reloads into the build its host serves now; a desktop build is replaced from the site. */
  readonly web: boolean;
}

export function runningGame(): RunningGame {
  return { version: GAME_VERSION, web: servedByBrowser() };
}

/** A server of another release: which side is older, and the server's version when it names one. */
export type VersionGap =
  | { readonly kind: 'outdated'; readonly required: string | null }
  | { readonly kind: 'ahead'; readonly server: string | null };

/** The site's download page in each menu language. */
const DOWNLOAD_PAGES: Readonly<Record<Locale, string>> = {
  eng: 'https://opennorthland.org/download/',
  pol: 'https://opennorthland.org/pl/download/',
  ger: 'https://opennorthland.org/de/download/',
  rus: 'https://opennorthland.org/ru/download/',
  ita: 'https://opennorthland.org/it/download/',
  chs: 'https://opennorthland.org/zh-Hans/download/',
  cht: 'https://opennorthland.org/zh-Hant/download/',
};

export function downloadPage(locale: Locale = currentLocale()): string {
  return DOWNLOAD_PAGES[locale];
}

/** One sentence telling a player whose game is older than a server how to get the new version. */
export function outdatedHint(game: RunningGame, copy: Messages = messages()): string {
  return game.web ? copy.updateNotice.reloadHint : copy.updateNotice.downloadHint;
}
