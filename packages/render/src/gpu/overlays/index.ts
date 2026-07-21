/**
 * The single-file retained overlay layers the {@link import('../world-renderer/index.js').WorldRenderer}
 * composes around its terrain / sprite-pool / map-object subsystems — each a pure projection of the
 * read-only snapshot + plain per-frame data into one slice of the scene graph:
 *  - ground marks below the sprites: the fog wash ({@link FogLayer}), the build-placement wash
 *    ({@link PlacementOverlayLayer}) and cursor ghost ({@link PlacementGhostLayer}), construction
 *    plots ({@link ConstructionPlotLayer}), selection rings ({@link SelectionLayer}), and combat
 *    litter ({@link CombatEffectsLayer});
 *  - markers above the sprites: door badges ({@link BadgeLayer}) and the `?debug=geometry` overlay
 *    ({@link GeometryDebugLayer});
 *  - the pinned/second-render surfaces: the HUD ({@link HudLayer}) and the details-panel portrait
 *    inset ({@link PortraitInsetLayer}).
 *
 * Grouped here (with an index barrel keeping external import paths stable) so the ~10 sibling layer
 * files stop widening a flat `gpu/`, mirroring the `gpu/terrain`, `gpu/sprite-pool`, `gpu/map-objects`
 * and `gpu/gallery` feature folders. Files inside the folder import their deps directly, not through
 * this barrel.
 */
export { BadgeLayer, type DoorBadge, type HouseholdKind } from './badge-layer.js';
export {
  type SettlerBubble,
  type SettlerBubbleGfx,
  type SettlerBubbleKind,
  SettlerBubbleLayer,
} from './bubble-layer.js';
export { CollapseLayer } from './collapse-layer.js';
export { type ConstructionPlotFrame, ConstructionPlotLayer } from './construction-plot.js';
export { DamageSmokeLayer } from './damage-smoke-layer.js';
export { CombatEffectsLayer } from './effects-layer.js';
export { FogLayer } from './fog-layer.js';
export { type GeometryDebugCell, type GeometryDebugItem, GeometryDebugLayer } from './geometry-debug.js';
export { DEFAULT_HUD_STYLE, type HudFrame, HudLayer, type HudStyle } from './hud-layer.js';
export { type PlacementGhost, PlacementGhostLayer } from './placement-ghost.js';
export {
  overlayBounds,
  type PlacementOverlayCell,
  type PlacementOverlayFrame,
  PlacementOverlayLayer,
} from './placement-overlay.js';
export { type PortraitInsetFrame, PortraitInsetLayer } from './portrait-inset.js';
export { SelectionLayer } from './selection-layer.js';
