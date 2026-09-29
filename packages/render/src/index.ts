export type { TextureSource } from 'pixi.js';
export { FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA, fogTileVisible } from './data/fog/index.js';
export {
  buildHud,
  emptyHud,
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
export { HumanPaletteCache } from './data/palettes/human-palette-cache.js';
export {
  type CartRecipe,
  type CharacterPalette,
  createHumanPaletteIdentity,
  HUMAN_PALETTE_BYTES,
  HumanPaletteBook,
  type HumanPaletteColours,
  type HumanPaletteIdentity,
} from './data/palettes/human-palettes.js';
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
  tileToScreenX,
  tileToScreenY,
  type Viewport,
  visibleTileRange,
} from './data/projection/index.js';
export {
  buildScene,
  buildSpriteScene,
  type DrawItem,
  type HolyFireBinding,
  type HolyFireLookup,
  type InHouseProgramLookup,
  indoorHouseOf,
  isIndoorSettler,
  palisadeStaggerX,
  type SceneGround,
  type SceneTerrain,
  terrainMapToScene,
  type VehicleDrawTask,
} from './data/scene/index.js';
export {
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  atlasFromManifest,
  type BuildingBobRef,
  type BuildingOverlayRef,
  type BuildingTribeTables,
  type BuildingTypeBinding,
  type BuildTimeSheet,
  type ByJobTable,
  buildTimeThreshold,
  type CarryingBinding,
  type CartDriveAnim,
  type ConstructionLayerRef,
  type CraftFxBinding,
  type CraftFxLoopRef,
  DEFAULT_FACING,
  type DirectionalAnim,
  type FishBinding,
  FLAG_WAVE_TICKS_PER_FRAME,
  type FrameListAnim,
  frameOf,
  GFX_DIR_TO_FACING,
  indexAtlasFrames,
  type LayeredBobRef,
  lookupFrame,
  type MunitionBinding,
  type PalisadeBinding,
  type ParticleRef,
  type ResourceTypeBinding,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSettlerBobId,
  resolveStockpileDraw,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type StockpileBinding,
  subClipKey,
  VEHICLE_ATTACK_TICKS,
  type VehicleBinding,
  type VehicleLook,
  type VehicleTribeLooks,
  type WaveLoop,
  waveFrameAt,
} from './data/sprites/index.js';
export {
  averagePatternColour,
  type BrightnessField,
  type CellTexture,
  cellColourResolver,
  cellColoursFromGround,
  type ElevationField,
  MINIMAP_CELL_UNRESOLVED,
  makeElevationField,
  mapPreviewSize,
  patternSrcRect,
  projectNode,
  projectTile,
  rasterizeTerrain,
  type TerrainCells,
  terrainLiftAt,
  terrainWorldBounds,
  texturePageKey,
  type WorldBounds,
} from './data/terrain/index.js';
export {
  type ClimateInput,
  LIGHTNING_RETAIN_SECONDS,
  THUNDER_MAX_DELAY_SECONDS,
  thunderDelaySeconds,
  WeatherClimate,
  type WindSway,
  windSway,
} from './data/weather/climate.js';
export { coverEquilibrium, WeatherCover } from './data/weather/cover.js';
export { stormOf, weatherIntensity } from './data/weather/precipitation.js';
export type { ClothIndexRanges } from './gpu/cloth-wind.js';
export { type DrawableResource, isDrawableResource, readable2dContext } from './gpu/drawable-resource.js';
export {
  AnimationGallery,
  clipDirs,
  GALLERY_DIRS,
  type GalleryCellSpec,
  type GalleryClip,
  type GalleryDirection,
  type GalleryPalette,
} from './gpu/gallery/index.js';
export type { GroundWave } from './gpu/ground-waves/index.js';
export { type HumanArmorPalettes, HumanPaletteLut } from './gpu/human-palette-lut.js';
export type { MapObjectSprite } from './gpu/map-objects/index.js';
export {
  type BadgeAnchor,
  type BuildingSignGfx,
  type BuildingSignKind,
  type BuildingSignSheet,
  badgeAnchor,
  CONSTRUCTION_SIGN_DX,
  type ConstructionSign,
  type DoorBadge,
  type DoorBadgeRole,
  type DoorBadgeRow,
  GARRISON_MAST_FALLBACK_DX,
  type GeometryDebugCell,
  type GeometryDebugItem,
  GeometryDebugLayer,
  type HouseholdKind,
  type HudFrame,
  type HudStyle,
  hitsGarrisonFlag,
  type LifeHeart,
  type MapViewFrame,
  type MapViewTarget,
  makePlaceholderStack,
  makeSignStack,
  type PlacementGhost,
  type PlacementOverlayCell,
  type PlacementOverlayFrame,
  type PortraitInsetFrame,
  type SettlerBubble,
  type SettlerBubbleGfx,
  type SettlerBubbleKind,
  SIGN_BASE_BELOW,
  SIGN_HALF_WIDTH,
  SIGN_HEIGHT,
  SIGN_STEP,
  signRowAt,
  type WorkAreaRing,
} from './gpu/overlays/index.js';
export {
  type GuiColorKey,
  PalettedSprite,
} from './gpu/paletted-sprite/index.js';
export {
  DEFAULT_PIXEL_ART_SCALER,
  PIXEL_ART_SCALERS,
  type PixelArtScaler,
  parsePixelArtScaler,
} from './gpu/pixel-art-registry.js';
export { createPixiApp, createWindowPixiApp, loadAtlasSource, windowResolutionFor } from './gpu/pixi-app.js';
export type { PlanRoadTextures } from './gpu/plan-road.js';
export type { PlanStakeTextures } from './gpu/plan-stake.js';
export { humanPaletteIdentity } from './gpu/sprite-pool/human-palette-row.js';
export {
  createPresentationTrack,
  type EntityBounds,
  type PresentationTrack,
  presentItem,
  type ResolvedLayer,
  resolveLayers,
  vehiclePalette,
} from './gpu/sprite-pool/index.js';
export {
  type CartDriveBinding,
  type PaletteLut,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SpriteLayer,
  type SpriteSheet,
  type VehicleColourLut,
  vehicleLutRow,
} from './gpu/sprite-sheet.js';
export {
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
export { flatTileColour, TerrainLayer } from './gpu/terrain/index.js';
export type { TerrainVertexColor } from './gpu/terrain/vertex-colors.js';
export type {
  GroundPattern,
  TerrainTextureSet,
  TransitionPattern,
} from './gpu/terrain-textures.js';
export { TextureCache } from './gpu/texture-cache.js';
export {
  type WeatherCoverTarget,
  WeatherGround,
  type WeatherGroundTerrain,
  type WeatherGroundView,
} from './gpu/weather/ground-weather.js';
export { WeatherSky, type WeatherSkyView } from './gpu/weather/weather-sky.js';
export {
  type BuildingHighlightItem,
  SPRITE_CULL_MARGIN,
  type WorldEnhancements,
  type WorldFrame,
  WorldRenderer,
  type WorldRendererOptions,
} from './gpu/world-renderer/index.js';
