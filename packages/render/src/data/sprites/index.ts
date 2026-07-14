/**
 * The PURE half of the atlas-sprite swap — which atlas frame a draw item references (a data lookup an
 * agent can self-verify); binding that rect to a GPU texture + sampling it is the GPU layer's half
 * (pixels, which only a human can judge). No Pixi, no canvas. Split by concern:
 *  - {@link import('./atlas.js')} — atlas frame geometry + the manifest adaptation;
 *  - {@link import('./bindings.js')} — the root {@link SpriteBindings} vocabulary;
 *  - {@link import('./settler-bindings.js')} / {@link import('./layered-bindings.js')} — the per-kind binding-table types;
 *  - {@link import('./settler.js')} — the settler state/facing/clock frame selection;
 *  - {@link import('./layered.js')} — the building/resource/stockpile layer decisions;
 *  - {@link import('./resolve.js')} — the top-level per-kind dispatch.
 */
export {
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  atlasFromManifest,
  type BuildTimeSheet,
  indexAtlasFrames,
  lookupFrame,
  type SpriteAtlas,
} from './atlas.js';
export type { SpriteBindings, SpriteKind } from './bindings.js';
export {
  bobKey,
  buildTimeThreshold,
  type ConstructionDraw,
  finishedBuildingBobKeys,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveStockpileDraw,
  resolveStockpileLayerDraws,
  unwrapBobRef,
} from './layered.js';
export type {
  BuildingBobRef,
  BuildingDraw,
  BuildingOverlayRef,
  BuildingTypeBinding,
  ConstructionLayerRef,
  LayeredBobRef,
  ResourceTypeBinding,
  StockpileBinding,
} from './layered-bindings.js';
export { resolveSpriteBobId, resolveSpriteFrame } from './resolve.js';
export { DEFAULT_FACING, pickByJob, resolveSettlerBobId } from './settler.js';
export type {
  ByJobTable,
  CarryingBinding,
  DirectionalAnim,
  FrameListAnim,
  SettlerStateBinding,
  SpriteFrameRef,
} from './settler-bindings.js';
