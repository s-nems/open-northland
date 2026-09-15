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
