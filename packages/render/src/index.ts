export type { TextureSource } from 'pixi.js';
export { FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA, fogTileVisible } from './data/fog/index.js';
export {
  buildHud,
  type HudCorner,
  type HudLabels,
  type HudLayout,
  type HudModel,
  type HudPlacement,
  type HudScreen,
  type HudTextRow,
  type JobCount,
  layoutHud,
  placeHud,
  type StockCount,
} from './data/hud/index.js';
export {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  cameraViewport,
  halfCellToScreen,
  ONE,
  TILE_HALF_H,
  TILE_HALF_W,
  type TileRange,
  tileToScreen,
  type Viewport,
  visibleTileRange,
} from './data/projection/index.js';
export {
  buildScene,
  buildSpriteScene,
  type DrawItem,
  type SceneGround,
  type SceneTerrain,
  terrainMapToScene,
} from './data/scene/index.js';
export {
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  atlasFromManifest,
  type BuildingBobRef,
  type BuildingOverlayRef,
  type BuildTimeSheet,
  type CarryingBinding,
  type ConstructionLayerRef,
  type DirectionalAnim,
  type FrameListAnim,
  indexAtlasFrames,
  type LayeredBobRef,
  type ResourceTypeBinding,
  resolveResourceDraw,
  resolveStockpileDraw,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type StockpileBinding,
} from './data/sprites/index.js';
export {
  type BrightnessField,
  type CellTexture,
  type ElevationField,
  makeElevationField,
  patternSrcRect,
} from './data/terrain/index.js';
export {
  AnimationGallery,
  clipDirs,
  GALLERY_DIRS,
  type GalleryCellSpec,
  type GalleryClip,
  type GalleryDirection,
} from './gpu/gallery/index.js';
export type { MapObjectSprite } from './gpu/map-objects/index.js';
export type {
  DoorBadge,
  GeometryDebugCell,
  GeometryDebugItem,
  HouseholdKind,
  HudFrame,
  HudStyle,
  PlacementGhost,
  PlacementOverlayCell,
  PlacementOverlayFrame,
  PortraitInsetFrame,
  SettlerBubble,
  SettlerBubbleGfx,
  SettlerBubbleKind,
} from './gpu/overlays/index.js';
export { type GuiColorKey, PalettedSprite } from './gpu/paletted-sprite/index.js';
export { createPixiApp, createWindowPixiApp, loadAtlasSource } from './gpu/pixi-app.js';
export { type EntityBounds, type ResolvedLayer, resolveLayers } from './gpu/sprite-pool/index.js';
export type {
  SettlerCharacter,
  SettlerCharacterSet,
  SpriteLayer,
  SpriteSheet,
} from './gpu/sprite-sheet.js';
export {
  bakeToFlippedSprite,
  bakeToSprite,
  createReusableBaker,
  oversampleFor,
  type ReusableBaker,
  type SupersampledTexture,
} from './gpu/supersample.js';
export {
  createSyntheticAtlasSource,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from './gpu/synthetic-atlas.js';
export { flatTileColour } from './gpu/terrain/index.js';
export type {
  GroundPattern,
  TerrainTextureSet,
  TransitionPattern,
} from './gpu/terrain-textures.js';
export {
  type BuildingHighlightItem,
  SPRITE_CULL_MARGIN,
  type WorldFrame,
  WorldRenderer,
  type WorldRendererOptions,
} from './gpu/world-renderer/index.js';

/*
 * The renderer is a pure consumer of sim state (see docs/ARCHITECTURE.md). It reads a snapshot
 * and draws; it never mutates the sim and the sim never imports this package. The live entry is
 * the retained {@link WorldRenderer}: it interpolates between the previous and current tick using
 * the `alpha` from the fixed-timestep driver so motion is smooth regardless of the 12 Hz sim rate.
 */
