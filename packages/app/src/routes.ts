/**
 * The URL mode table. Every entry module sits behind a dynamic import, so a boot downloads and parses
 * only the mode it was asked for; choosing the mode must stay free of the loading it decides on.
 */

export type RouteId = 'shot' | 'backdrop' | 'scene' | 'art' | 'anim' | 'icons' | 'sounds' | 'map' | 'menu';

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

/** First match wins, so a URL carrying two mode flags takes the earlier one. */
const ROUTES: readonly Route[] = [
  {
    id: 'art',
    matches: (params) => params.get('art') === 'gallery',
    load: () => import('./entries/art-gallery/index.js').then((m) => m.renderArtGallery),
  },
  {
    id: 'art',
    matches: (params) => params.has('art'),
    load: () => import('./entries/art-review/index.js').then((m) => m.renderArtReview),
  },
  {
    id: 'shot',
    matches: (params) => params.has('shot'),
    load: () => import('./entries/shot.js').then((m) => m.renderShot),
  },
  {
    id: 'backdrop',
    matches: (params) => params.has('backdrop'),
    load: () => import('./entries/backdrop.js').then((m) => m.renderBackdrop),
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
