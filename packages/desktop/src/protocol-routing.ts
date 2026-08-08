/** The `app://` naming rules, kept free of `electron` imports so each one stays unit-testable. */

export const APP_SCHEME = 'app';

export const APP_ORIGIN_PREFIX = `${APP_SCHEME}://`;

export const GAME_HOST = 'game';
export const SETUP_HOST = 'setup';

/** The one origin test behind the IPC sender and navigation guards; an unreported URL is never ours. */
export function isAppUrl(url: string | undefined): boolean {
  return (url ?? '').startsWith(APP_ORIGIN_PREFIX);
}

/**
 * The content-route path an `app://` request maps to, or `undefined` for the routeless setup host.
 * Pixi mis-joins a worker's root-relative `/bobs/<stem>.png` into `app://bobs/<stem>.png`, so folding
 * that host back into the pathname makes both spellings hit the same route table.
 */
export function routePathOf(host: string, rawPathname: string): string | undefined {
  if (host === GAME_HOST) return rawPathname;
  if (host === SETUP_HOST) return undefined;
  return `/${host}${rawPathname}`;
}

/** The queries `packages/app/src/routes.ts` sends to a playable world rather than to the main menu. */
const SESSION_PARAMS = ['map', 'scene'] as const;

function gamePageUrl(url: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === `${APP_SCHEME}:` && parsed.host === GAME_HOST ? parsed : undefined;
}

/**
 * Whether a game page has a world in progress, so navigating away loses it (there is no saving yet).
 * The menu page is a game URL too and carries params of its own, so a non-empty query proves nothing.
 */
export function isInGameSession(url: string): boolean {
  const parsed = gamePageUrl(url);
  return parsed !== undefined && SESSION_PARAMS.some((param) => parsed.searchParams.has(param));
}

/** Whether `url` is a web-app page at all - the menu, a world, or any of its direct entries. */
export function isGamePage(url: string): boolean {
  return gamePageUrl(url) !== undefined;
}
