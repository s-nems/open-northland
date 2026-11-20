/** The `app://` naming rules, kept free of `electron` imports so each one stays unit-testable. */

export const APP_SCHEME = 'app';

export const APP_ORIGIN_PREFIX = `${APP_SCHEME}://`;

export const GAME_HOST = 'game';

/** The one origin test behind the navigation guard; an unreported URL is never ours. */
export function isAppUrl(url: string | undefined): boolean {
  return (url ?? '').startsWith(APP_ORIGIN_PREFIX);
}

/**
 * The game-origin path an `app://` request maps to. Pixi mis-joins a worker's root-relative
 * `/bobs/<stem>.png` or `/assets/<file>` into `app://bobs/<stem>.png`, so folding that host back into
 * the pathname makes both spellings name the same static file.
 */
export function routePathOf(host: string, rawPathname: string): string {
  return host === GAME_HOST ? rawPathname : `/${host}${rawPathname}`;
}

/** The schemes a link the game opens may use; the system hands it to the browser or mail client. */
const EXTERNAL_PROTOCOLS: readonly string[] = ['https:', 'http:', 'mailto:'];

/** The URL to hand the system for a link the game opens, or null for anything else. */
export function externalPageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return EXTERNAL_PROTOCOLS.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The environment variable that points the game at another map catalogue server. */
export const API_URL_ENV = 'ON_API_URL';
/** The environment variable that points the menu's release feed at another website. */
export const SITE_URL_ENV = 'ON_SITE_URL';

/** The first page with the server overrides as the app's `?api=` and `?site=` parameters, when set. */
export function initialGameUrl(
  gameUrl: string,
  apiOverride: string | undefined,
  siteOverride: string | undefined,
): string {
  const url = new URL(gameUrl);
  for (const [param, raw] of [
    ['api', apiOverride],
    ['site', siteOverride],
  ] as const) {
    const override = raw === undefined ? null : externalPageUrl(raw);
    if (override !== null) url.searchParams.set(param, override);
  }
  return url.toString();
}
