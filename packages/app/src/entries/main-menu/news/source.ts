import {
  type NewsDocument,
  type ReleaseFeed,
  type Validated,
  validateReleaseFeed,
  validateServedNewsDocument,
} from '@open-northland/data';
import { API_PARAM, apiBase, apiBaseUrl, automationWithoutServer } from '../../../content/map-source/api.js';
import { diag } from '../../../diag/index.js';
import type { MenuNews } from './model.js';

export const NEWS_REQUEST_TIMEOUT_MS = 10_000;
/** The website whose release feed the menu reads unless `?site=` names another. */
export const DEFAULT_SITE_URL = 'https://opennorthland.org';
const SITE_PARAM = 'site';

export const newsUrl = (api: string): string => `${api}/v1/news`;
export const releaseFeedUrl = (site: string): string => `${site}/releases/feed.json`;

export function siteBaseUrl(search: string = window.location.search): string {
  return apiBase(new URLSearchParams(search).get(SITE_PARAM)) ?? DEFAULT_SITE_URL;
}

export interface NewsSourceEnv {
  readonly fetch: typeof fetch;
  readonly search: string;
  /** A browser under automation reads only the sources its URL names, so no harness reaches the live
   *  hosts by itself. */
  readonly automated: boolean;
}

const browserEnv = (): NewsSourceEnv => ({
  fetch: (input, init) => fetch(input, init),
  search: window.location.search,
  automated: navigator.webdriver,
});

async function fetchValidated<T>(
  url: string,
  validate: (raw: unknown) => Validated<T>,
  env: NewsSourceEnv,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    const response = await env.fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(NEWS_REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const checked = validate(await response.json());
    if (!checked.ok) throw new Error(checked.reason);
    return checked.value;
  } catch (error) {
    // A menu that closed before the answer has nobody to tell.
    if (!signal.aborted) diag.warn('menu', 'news: a source is unavailable', { url, error: String(error) });
    return null;
  }
}

/** Both sources at once; either one that fails is left out. */
export async function loadMenuNews(
  signal: AbortSignal,
  env: NewsSourceEnv = browserEnv(),
): Promise<MenuNews> {
  const named = (param: string): boolean => !automationWithoutServer(param, env.search, env.automated);
  const [news, feed] = await Promise.all([
    named(API_PARAM)
      ? fetchValidated<NewsDocument>(newsUrl(apiBaseUrl(env.search)), validateServedNewsDocument, env, signal)
      : null,
    named(SITE_PARAM)
      ? fetchValidated<ReleaseFeed>(releaseFeedUrl(siteBaseUrl(env.search)), validateReleaseFeed, env, signal)
      : null,
  ]);
  return { news, feed };
}
