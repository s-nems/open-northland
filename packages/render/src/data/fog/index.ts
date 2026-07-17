/**
 * The fog folder: the render side of fog-of-war — the per-cell mask reads and washes the sim's `FogView`
 * feeds ({@link import('./mask.js')}), and the remembered-statics ghost store built on top of them
 * ({@link import('./ghosts.js')}). Pure math, no Pixi.
 */

export { type FogGhost, FogGhostStore } from './ghosts.js';
export {
  FOG_EXPLORED_ALPHA,
  FOG_GHOST_TINT,
  FOG_UNEXPLORED_ALPHA,
  fogCellOfTile,
  fogGhostTint,
  fogTileVisible,
} from './mask.js';
