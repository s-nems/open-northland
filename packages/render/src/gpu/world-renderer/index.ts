/**
 * The retained world renderer: the orchestrator ({@link import('./world-renderer.js')}) composing the
 * sub-layers, its public data contract ({@link import('./frame.js')}), and the two folder-internal
 * collaborators it owns directly, the viewer's fog ({@link import('./world-fog.js')}) and the
 * screen-space chrome ({@link import('./world-chrome.js')}).
 */
export {
  type BuildingHighlightItem,
  SPRITE_CULL_MARGIN,
  type WorldFrame,
  type WorldRendererOptions,
} from './frame.js';
export { WorldRenderer } from './world-renderer.js';
