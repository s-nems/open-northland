/**
 * The retained terrain feature: the chunked, AABB-culled static ground layer
 * ({@link import('./terrain-layer.js')}), built once by the textured / flat mesh emitters
 * ({@link import('./build-ground.js')} / {@link import('./build-flat.js')}) on the shared
 * {@link import('./geometry.js')} primitives; its per-chunk draw-call batcher
 * ({@link import('./chunk-batcher.js')}) is folder-internal.
 */
export { flatTileColour, TERRAIN_CHUNK_TILES } from './geometry.js';
export { TerrainLayer } from './terrain-layer.js';
