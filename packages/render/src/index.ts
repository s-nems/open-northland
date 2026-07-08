export {
  CALIBRATED_HALF_H,
  CALIBRATED_HALF_W,
  ONE,
  TILE_HALF_W,
  TILE_HALF_H,
  halfCellToScreen,
  setTilePitch,
  tileToScreen,
  type Camera,
} from './data/iso.js';
export {
  buildScene,
  buildSpriteScene,
  drawableEntityRefs,
  terrainMapToScene,
  type DrawItem,
  type DrawKind,
  type SceneGround,
  type SceneTerrain,
  type SpriteState,
} from './data/scene/index.js';
export { depositVisualLevel } from './data/scene/index.js';
export {
  atlasFromManifest,
  indexAtlasFrames,
  pickByJob,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveStockpileDraw,
  resolveStockpileLayerDraws,
  resolveSpriteFrame,
  resolveSpriteBobId,
  DEFAULT_FACING,
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  type BuildingBobRef,
  type BuildingDraw,
  type BuildingTypeBinding,
  type ByJobTable,
  type CarryingBinding,
  type ConstructionLayerRef,
  type DirectionalAnim,
  type LayeredBobRef,
  type ResourceTypeBinding,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type SpriteKind,
  type StockpileBinding,
} from './data/sprites/index.js';
export {
  createPixiApp,
  createWindowPixiApp,
  loadAtlasSource,
  type GroundPattern,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SpriteSheet,
  type SpriteLayer,
  type TerrainTextureSet,
} from './gpu/pixi-app.js';
export { WorldRenderer } from './gpu/world-renderer.js';
export {
  compactResolvedStockpileLayers,
  reconcileSprites,
  trackMotion,
  type EntityBounds,
  type MotionTrack,
} from './gpu/sprite-pool/index.js';
export { DEFAULT_HUD_STYLE, type HudStyle, type HudFrame } from './gpu/hud-layer.js';
export type { MapObjectSprite } from './gpu/map-objects/index.js';
export {
  AnimationGallery,
  galleryCellLayout,
  clipDirs,
  galleryBobId,
  headBobId,
  GALLERY_DIRS,
  COMPASS_TO_BLOCK,
  type GalleryClip,
  type GalleryCellSpec,
  type GalleryDirection,
  type GalleryCellBox,
} from './gpu/gallery/index.js';
export { type GuiColorKey, PalettedSprite } from './gpu/paletted-sprite.js';
export { type SupersampledTexture, bakeToFlippedSprite } from './gpu/supersample.js';
export type { TextureSource } from 'pixi.js';
export {
  cameraViewport,
  isVisible,
  aabbIntersects,
  visibleTileRange,
  type Viewport,
  type Box,
  type TileRange,
} from './data/viewport.js';
export {
  DIAMOND_INDICES,
  TRIANGLE_A_CORNERS,
  TRIANGLE_B_CORNERS,
  diamondCorners,
  rectUVs,
  patternSrcRect,
  triangleCorners,
  triangleUVs,
  type SrcRect,
  type CellTexture,
} from './data/terrain.js';
export {
  ELEVATION_LIFT,
  makeElevationField,
  diamondCornerLifts,
  type ElevationField,
} from './data/elevation.js';
export {
  buildHud,
  layoutHud,
  placeHud,
  IDLE_JOB,
  type HudModel,
  type HudLayout,
  type HudTextRow,
  type HudPlacement,
  type HudCorner,
  type HudScreen,
  type JobCount,
  type StockCount,
} from './data/hud.js';
export {
  createSyntheticAtlasSource,
  syntheticAtlasFrames,
  SYNTHETIC_BINDINGS,
  SYNTHETIC_ATLAS_WIDTH,
  SYNTHETIC_ATLAS_HEIGHT,
} from './gpu/synthetic-atlas.js';

/*
 * The renderer is a PURE CONSUMER of sim state (see docs/ARCHITECTURE.md). It reads a snapshot
 * and draws; it never mutates the sim and the sim never imports this package. The live entry is
 * the retained {@link WorldRenderer}: it interpolates between the previous and current tick using
 * the `alpha` from the fixed-timestep driver so motion is smooth regardless of the 20Hz sim rate.
 */
