import type { RouteId } from '../routes.js';

/** What the host's `version.json` says it serves now. `build` is the page's entry script path, which
 *  tells two builds of one version apart; `restore` is what a save needs to restore in it. */
export interface ServedBuild {
  readonly version: string;
  readonly build: string;
  readonly restore: string | null;
}

/** Why a check ran: on a timer or a returning tab, after this page failed to load one of its own
 *  modules (the host dropped the build it came from), or after the relay closed for a restart. */
export type CheckCause = 'routine' | 'staleCode' | 'relayRestart';

/** How Chromium, Firefox and Safari word a module the page asked for and could not load. */
const MODULE_LOAD_FAILURES: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

/** An uncaught error says this build is gone from the host only when a module of it failed to load. */
export function isStaleCodeError(message: string): boolean {
  return MODULE_LOAD_FAILURES.some((pattern) => pattern.test(message));
}

/** Where the player is, as far as a reload's cost goes. */
export type UpdatePlace = 'menu' | 'localGame' | 'relayGame';

/** Tools and galleries lose nothing on a reload, so they count as the menu. */
const PLACE_OF_ROUTE: Readonly<Record<RouteId, UpdatePlace>> = {
  menu: 'menu',
  checkout: 'menu',
  shot: 'menu',
  anim: 'menu',
  icons: 'menu',
  sounds: 'menu',
  scene: 'localGame',
  map: 'localGame',
  relay: 'relayGame',
};

export function placeOfRoute(route: RouteId): UpdatePlace {
  return PLACE_OF_ROUTE[route];
}

export type UpdateOffer =
  | { readonly kind: 'none' }
  /** This tab may not go on: reload at once, to the menu when the room it was in is gone, carrying a
   *  local game over when the new build reads its save. */
  | { readonly kind: 'reloadNow'; readonly toMenu: boolean; readonly carry: boolean }
  /** Nothing to lose: reload after a countdown the player may cut short or put off. */
  | { readonly kind: 'countdown' }
  /** A local game whose save the new build reads: offer to carry it over the reload. */
  | { readonly kind: 'continue' }
  /** A local game the new build cannot take over: finish it or reload. */
  | { readonly kind: 'finishOrReload' }
  /** A relayed game runs on until the relay restarts. */
  | { readonly kind: 'finishThenReload' }
  /** A reload into this build already happened and still left the old one here. */
  | { readonly kind: 'manual' };

export interface UpdateSituation {
  /** The entry script this page booted from. */
  readonly runningBuild: string;
  readonly served: ServedBuild;
  readonly cause: CheckCause;
  readonly place: UpdatePlace;
  /** The restore identity of a running local game that can stage itself; null when none can. */
  readonly carriedRestore: string | null;
  /** The build the last automatic reload of this tab went for, if any. */
  readonly reloadedFor: string | null;
}

export function updateOffer(situation: UpdateSituation): UpdateOffer {
  const { served, cause, place } = situation;
  if (served.build === situation.runningBuild) return { kind: 'none' };
  // A second automatic reload would only loop over whatever keeps serving this tab the old build.
  if (situation.reloadedFor === served.build) return { kind: 'manual' };
  const carries = served.restore !== null && served.restore === situation.carriedRestore;
  if (cause === 'relayRestart') return { kind: 'reloadNow', toMenu: true, carry: false };
  if (cause === 'staleCode')
    return { kind: 'reloadNow', toMenu: place === 'relayGame', carry: place === 'localGame' && carries };
  switch (place) {
    case 'menu':
      return { kind: 'countdown' };
    case 'relayGame':
      return { kind: 'finishThenReload' };
    case 'localGame':
      return carries ? { kind: 'continue' } : { kind: 'finishOrReload' };
  }
}

/** The served build, or null for anything else: a proxy's error page or a half-written file is silence. */
export function parseServedBuild(raw: unknown): ServedBuild | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (!('version' in raw) || !('build' in raw) || !('restore' in raw)) return null;
  const { version, build, restore } = raw;
  if (typeof version !== 'string' || version === '') return null;
  if (typeof build !== 'string' || !build.startsWith('/')) return null;
  if (restore !== null && typeof restore !== 'string') return null;
  return { version, build, restore };
}

/** The menu's search for a reload out of a room that no longer exists: only the language carries over. */
export function menuSearch(search: string): string {
  const lang = new URLSearchParams(search).get('lang');
  return lang === null ? '' : `?${new URLSearchParams({ lang }).toString()}`;
}
