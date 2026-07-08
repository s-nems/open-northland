/**
 * The retained terrain feature: the chunked, AABB-culled static ground layer
 * ({@link import('./terrain-layer.js')}) and its per-chunk draw-call batcher
 * ({@link import('./chunk-batcher.js')}).
 */
export { ChunkBatcher, type TerrainBatch, meshGeometry } from './chunk-batcher.js';
export { TERRAIN_CHUNK_TILES, TerrainLayer } from './terrain-layer.js';
