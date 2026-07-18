/**
 * The retained terrain feature: the chunked, AABB-culled static ground layer
 * ({@link import('./terrain-layer.js')}), built once by the textured / flat mesh emitters
 * ({@link import('./build-ground.js')} / {@link import('./build-flat.js')}) on the shared
 * {@link import('./geometry.js')} primitives, with the shading lane's R8 upload padding in
 * {@link import('./lane-texture.js')}; its per-chunk draw-call batcher
 * ({@link import('./chunk-batcher.js')}) is folder-internal.
 */
export { DEFAULT_TILE_COLOUR, flatTileColour, TERRAIN_CHUNK_TILES } from './geometry.js';
export { padLaneRows } from './lane-texture.js';
export { TerrainLayer } from './terrain-layer.js';
