/**
 * One request per content route the resolver claims, as plain data so the image smoke check needs
 * no build of the workspace. `smoke-routes.test.ts` pins this list to the resolver's own table.
 */
export const CONTENT_ROUTES = [
  '/ir.json',
  '/maps-index',
  '/bobs-index',
  '/backdrops-index',
  '/maps/probe.json',
  '/bobs/probe.png',
  '/textures/probe.png',
  '/sounds/probe.wav',
  '/gui/probe.json',
  '/gui-bitmaps/probe.png',
  '/goods/probe.json',
  '/backdrops/probe.jpg',
];
