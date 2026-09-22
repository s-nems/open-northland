/// <reference types="vite/client" />
/**
 * The URL mode table. Every entry module sits behind a dynamic import, so a boot downloads and parses
 * only the mode it was asked for; choosing the mode must stay free of the loading it decides on.
 */

/** `checkout` names a mode a checkout adds through `src/custom/routes.ts`. */
export type RouteId = 'checkout' | 'shot' | 'scene' | 'anim' | 'icons' | 'sounds' | 'relay' | 'map' | 'menu';

/** Every entry module conforms to this, so the dispatcher never adapts a per-mode call shape. */
export type EntryRunner = (canvas: HTMLCanvasElement, params: URLSearchParams) => void | Promise<void>;

export interface Route {
  readonly id: RouteId;
  readonly matches: (params: URLSearchParams) => boolean;
  readonly load: () => Promise<EntryRunner>;
}

const MENU_ROUTE: Route = {
  id: 'menu',
  matches: () => true,
  load: () => import('./entries/main-menu/index.js').then((m) => m.renderMainMenu),
};

// A checkout with custom art adds its review modes; they take precedence over the built-in ones.
const checkoutRoutes =
  Object.values(
    import.meta.glob<{ readonly checkoutRoutes: readonly Route[] }>('./custom/routes.ts', { eager: true }),
  )[0]?.checkoutRoutes ?? [];

/** First match wins, so a URL carrying two mode flags takes the earlier one. */
const ROUTES: readonly Route[] = [
  ...checkoutRoutes,
  {
    id: 'shot',
    matches: (params) => params.has('shot'),
    load: () => import('./entries/shot.js').then((m) => m.renderShot),
  },
  {
    id: 'scene',
    matches: (params) => params.has('scene'),
    load: () => import('./entries/scene.js').then((m) => m.renderSceneMode),
  },
  {
    id: 'anim',
    matches: (params) => params.has('anim'),
    load: () => import('./entries/anim.js').then((m) => m.renderAnimationGallery),
  },
  {
    id: 'icons',
    matches: (params) => params.has('icons'),
    load: () => import('./entries/icons.js').then((m) => m.renderIconGallery),
  },
  {
    id: 'sounds',
    matches: (params) => params.has('sounds'),
    load: () => import('./entries/sound.js').then((m) => m.renderSoundGallery),
  },
  // Before `map`: a relayed game's creator names the map in the same search.
  {
    id: 'relay',
    matches: (params) => params.has('relay'),
    load: () => import('./entries/relay.js').then((m) => m.renderRelayGame),
  },
  {
    id: 'map',
    matches: (params) => params.has('map'),
    load: () => import('./entries/map.js').then((m) => m.renderMap),
  },
  MENU_ROUTE,
];

export function routeFor(params: URLSearchParams): Route {
  // The menu closes the table and matches anything, so the fallback stands in for an assertion.
  return ROUTES.find((route) => route.matches(params)) ?? MENU_ROUTE;
}
