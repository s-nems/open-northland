export type { TextureSource } from 'pixi.js';
export {
  BRIGHTNESS_NEUTRAL,
  type BrightnessField,
  makeBrightnessField,
} from './data/brightness.js';
export {
  type ElevationField,
  elevationLiftPerUnit,
  makeElevationField,
} from './data/elevation.js';
export {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  fogCellOfTile,
  fogTileVisible,
} from './data/fog.js';
export {
  buildHud,
  type HudCorner,
  type HudLayout,
  type HudModel,
  type HudPlacement,
  type HudScreen,
  type HudTextRow,
  IDLE_JOB,
  type JobCount,
  layoutHud,
  placeHud,
  type StockCount,
} from './data/hud.js';
export {
  CALIBRATED_HALF_H,
  CALIBRATED_HALF_W,
  type Camera,
  halfCellToScreen,
  ONE,
  setTilePitch,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
} from './data/iso.js';
export {
  buildScene,
  buildSpriteScene,
  type DrawItem,
  type DrawKind,
  depositVisualLevel,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
  type SceneGround,
  type SceneTerrain,
  type SceneTransitions,
  type SpriteSceneOptions,
  type SpriteState,
  terrainMapToScene,
} from './data/scene/index.js';
export {
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  atlasFromManifest,
  type BuildingBobRef,
  type BuildingDraw,
  type BuildingOverlayRef,
  type BuildingTypeBinding,
  type ByJobTable,
  bobKey,
  type CarryingBinding,
  type ConstructionLayerRef,
  DEFAULT_FACING,
  type DirectionalAnim,
  type FrameListAnim,
  finishedBuildingBobKeys,
  indexAtlasFrames,
  type LayeredBobRef,
  pickByJob,
  type ResourceTypeBinding,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSpriteBobId,
  resolveSpriteFrame,
  resolveStockpileDraw,
  resolveStockpileLayerDraws,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type SpriteKind,
  type StockpileBinding,
} from './data/sprites/index.js';
export {
  type CellTexture,
  cellNode,
  type NodeXY,
  nodeCell,
  nodeLaneUV,
  nodeLift,
  patternSrcRect,
  rectTriangleUVs,
  type SrcRect,
  TRANSITION_NONE,
  transitionRef,
  triangleANodes,
  triangleBNodes,
  triangleUVs,
} from './data/terrain.js';
export {
  aabbIntersects,
  type Box,
  cameraViewport,
  isVisible,
  type TileRange,
  type Viewport,
  visibleTileRange,
} from './data/viewport.js';
export type { DoorBadge } from './gpu/badge-layer.js';
export {
  AnimationGallery,
  COMPASS_TO_BLOCK,
  clipDirs,
  GALLERY_DIRS,
  type GalleryCellBox,
  type GalleryCellSpec,
  type GalleryClip,
  type GalleryDirection,
  galleryBobId,
  galleryCellLayout,
  headBobId,
} from './gpu/gallery/index.js';
export type { GeometryDebugCell, GeometryDebugItem } from './gpu/geometry-debug.js';
export { DEFAULT_HUD_STYLE, type HudFrame, type HudStyle } from './gpu/hud-layer.js';
export type { MapObjectSprite } from './gpu/map-objects/index.js';
export { type GuiColorKey, PalettedSprite } from './gpu/paletted-sprite.js';
export {
  createPixiApp,
  createWindowPixiApp,
  type GroundPattern,
  loadAtlasSource,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SpriteLayer,
  type SpriteSheet,
  type TerrainTextureSet,
  type TransitionPattern,
} from './gpu/pixi-app.js';
export type { PlacementGhost } from './gpu/placement-ghost.js';
export type { PlacementOverlayCell, PlacementOverlayFrame } from './gpu/placement-overlay.js';
export type { PortraitInsetFrame } from './gpu/portrait-inset.js';
export {
  compactResolvedStockpileLayers,
  type EntityBounds,
  type MotionTrack,
  reconcileSprites,
  resolveLayers,
  trackMotion,
} from './gpu/sprite-pool/index.js';
export type { ResolvedLayer } from './gpu/sprite-pool/resolve-layers.js';
export {
  bakeToFlippedSprite,
  bakeToSprite,
  oversampleFor,
  type SupersampledTexture,
} from './gpu/supersample.js';
export {
  createSyntheticAtlasSource,
  SYNTHETIC_ATLAS_HEIGHT,
  SYNTHETIC_ATLAS_WIDTH,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from './gpu/synthetic-atlas.js';
export { flatTileColour } from './gpu/terrain/terrain-layer.js';
export { SPRITE_CULL_MARGIN, WorldRenderer } from './gpu/world-renderer.js';

/*
 * The renderer is a PURE CONSUMER of sim state (see docs/ARCHITECTURE.md). It reads a snapshot
 * and draws; it never mutates the sim and the sim never imports this package. The live entry is
 * the retained {@link WorldRenderer}: it interpolates between the previous and current tick using
 * the `alpha` from the fixed-timestep driver so motion is smooth regardless of the 20Hz sim rate.
 */
