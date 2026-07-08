/**
 * The retained landscape-object feature: a decoded map's placed trees/stones/waves, split into batched
 * ground decor ({@link import('./decor-batch.js')}, folder-internal) and pooled tall sprites that
 * depth-sort against entities ({@link import('./map-object-layer.js')}).
 */
export { MapObjectLayer } from './map-object-layer.js';
export type { MapObjectSprite } from './map-object-sprite.js';
