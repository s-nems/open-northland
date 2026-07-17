/**
 * The retained world renderer: the orchestrator ({@link import('./world-renderer.js')}) composing the
 * sub-layers, its public data contract ({@link import('./frame.js')}), and the screen-space chrome it
 * owns directly — the pause wash, the post-fx vignette and the zoom sampling toggle
 * ({@link import('./world-chrome.js')}, folder-internal).
 */
export {
  type BuildingHighlightItem,
  SPRITE_CULL_MARGIN,
  type WorldFrame,
  type WorldRendererOptions,
} from './frame.js';
export { WorldRenderer } from './world-renderer.js';
