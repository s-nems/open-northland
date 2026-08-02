/** The `app://` naming rules, kept free of `electron` imports so each one stays unit-testable. */

export const APP_SCHEME = 'app';

export const APP_ORIGIN_PREFIX = `${APP_SCHEME}://`;

export const GAME_HOST = 'game';
export const SETUP_HOST = 'setup';

/**
 * The one origin test behind both the IPC sender guard and the window's navigation guard. A URL the
 * caller could not report is never one of ours.
 */
export function isAppUrl(url: string | undefined): boolean {
  return (url ?? '').startsWith(APP_ORIGIN_PREFIX);
}

/**
 * The content-route path an `app://` request maps to, or `undefined` for the routeless setup host.
 * Pixi's path resolver mis-joins root-relative asset URLs on a custom scheme: a worker-side
 * `/bobs/<stem>.png` arrives as `app://bobs/<stem>.png` - the route segment lands in the URL host, so
 * folding it back into the pathname makes both spellings hit the same route table.
 */
export function routePathOf(host: string, rawPathname: string): string | undefined {
  if (host === GAME_HOST) return rawPathname;
  if (host === SETUP_HOST) return undefined;
  return `/${host}${rawPathname}`;
}

/** The queries `packages/app/src/main.ts` routes to a playable world rather than to the main menu. */
const SESSION_PARAMS = ['map', 'scene'] as const;

/**
 * Whether a loaded URL is a game page with a world in progress, so leaving it loses a session (there
 * is no saving yet). The menu page is a game URL too and always carries `?lang=`, so having a query
 * proves nothing.
 */
export function isInGameSession(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== GAME_HOST) return false;
  return SESSION_PARAMS.some((param) => parsed.searchParams.has(param));
}
