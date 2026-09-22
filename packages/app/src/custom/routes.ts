import type { Route } from '../routes.js';

/** The custom art review modes, behind the same lazy thunks as the built-in entries. */
export const checkoutRoutes: readonly Route[] = [
  {
    id: 'checkout',
    matches: (params) => params.get('art') === 'gallery',
    load: () => import('./art-gallery/index.js').then((m) => m.renderArtGallery),
  },
  {
    id: 'checkout',
    matches: (params) => params.has('art'),
    load: () => import('./art-review/index.js').then((m) => m.renderArtReview),
  },
];
