export type { TextureSource } from 'pixi.js';
export { type FootfallGround, footfallGround } from './data/effects/footfall.js';
export {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  type FogGhost,
  type FogGhostMemory,
  fogTileExplored,
  fogTileVisible,
  type GhostSource,
  type RememberedMarkers,
  type SeenRoadNetwork,
  type Sight,
  UnseenChanges,
} from './data/fog/index.js';
export {
  buildHud,
  emptyHud,
  type HudCorner,
  type HudLabels,
  type HudLayout,
  type HudModel,
  type HudPeople,
  type HudPlacement,
  type HudScreen,
  type HudTextRow,
  hudPeopleOf,
  type JobCount,
  layoutHud,
  placeHud,
  type StockCount,
} from './data/hud/index.js';
export {
  type MinimapFeature,
  type MinimapObjectLanes,
  type MinimapObjects,
  minimapFeatureOfGood,
  minimapObjectLanes,
} from './data/minimap/features.js';
export {
  averagePatternColour,
  cellColourResolver,
  cellColoursFromGround,
  MINIMAP_CELL_UNRESOLVED,
  mapPreviewSize,
  type TerrainCells,
  terrainWorldBounds,
  type WorldBounds,
} from './data/minimap/map-preview.js';
export {
  MINIMAP_DEPOSIT_KINDS,
  type MinimapDepositKind,
  type MinimapScene,
  minimapScene,
} from './data/minimap/scene.js';
export { rasterizeMinimap } from './data/minimap/style.js';
export { GLOW_PALETTE_INDEX, liftDarkGlowColour } from './data/palettes/glow-colour.js';
export { HumanPaletteCache } from './data/palettes/human-palette-cache.js';
export {
  type ArmorBand,
  type ArmorLayout,
  type ArmorRamp,
  type CartRecipe,
  type CharacterPalette,
  createHumanPaletteColours,
  createHumanPaletteIdentity,
  HUMAN_PALETTE_BYTES,
  HumanPaletteBook,
  type HumanPaletteColours,
  type HumanPaletteIdentity,
  headPaletteBand,
  type LoadLayout,
  UNARMORED_TIER,
  type WeaponLayout,
} from './data/palettes/human-palettes.js';
export {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  cameraViewport,
  halfCellToScreen,
  halfCellToScreenX,
  halfCellToScreenY,
  ONE,
  rowStagger,
  screenToHalfCell,
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
  palisadeColumnShiftX,
  type SceneGround,
  type SceneTerrain,
  terrainMapToScene,
  type VehicleDrawTask,
  vehicleDrawTile,
} from './data/scene/index.js';
export {
  type AtlasFrame,
  type AtlasImageEncoding,
  type AtlasManifest,
  type BuildingBobRef,
  type BuildingLandscapeOverlayRef,
  type BuildingOverlayRef,
  type BuildingSkinTables,
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
  type FamilyEffectsBinding,
  type FishBinding,
  FLAG_WAVE_TICKS_PER_FRAME,
  type FootfallBinding,
  type FrameListAnim,
  frameOf,
  GFX_DIR_TO_FACING,
  indexAtlasFrames,
  type LayeredBobRef,
  lookupFrame,
  type MunitionBinding,
  type PalisadeBinding,
  type ParticleRef,
  type ResourceLevelRef,
  type ResourceLoopRef,
  type ResourceTypeBinding,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSettlerBobId,
  resolveStockpileDraw,
  type SettlerStateBinding,
  type ShipYardSites,
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
  type BrightnessField,
  type CellTexture,
  type ElevationField,
  makeElevationField,
  patternSrcRect,
  projectNode,
  projectTile,
  terrainLiftAt,
  texturePageKey,
  type WaterCellFractions,
  waterCellFractions,
} from './data/terrain/index.js';
export { buildWeatherField, type WeatherField } from './data/weather/field.js';
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
export {
  type MapObjectSprite,
  mapObjectBounds,
  mapObjectPixelHit,
  type OneShotClip,
  oneShotEndTick,
} from './gpu/map-objects/index.js';
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
  type ExperienceStar,
  type ExperienceStarGfx,
  GARRISON_MAST_FALLBACK_DX,
  type GeometryDebugCell,
  type GeometryDebugItem,
  GeometryDebugLayer,
  type HouseholdKind,
  type HudFrame,
  type HudStyle,
  hitsGarrisonFlag,
  type ImportMarkerGfx,
  type LifeHeart,
  LOST_GOAL_COLOUR,
  LOST_GOAL_OUTLINE,
  type LostGoalMarker,
  lostGoalPose,
  makePlaceholderStack,
  makeSignStack,
  type OrderMarker,
  type OrderMarkerKind,
  orderMarkerPose,
  type SettlerBubble,
  type SettlerBubbleGfx,
  type SettlerBubbleKind,
  SIGN_BASE_BELOW,
  SIGN_HALF_WIDTH,
  SIGN_STEP,
  STAR_TIERS,
  signRowAt,
} from './gpu/overlays/index.js';
export {
  type GuiColorKey,
  PalettedSprite,
} from './gpu/paletted-sprite/index.js';
export {
  type AtlasSheetLayout,
  DEFAULT_PIXEL_ART_SCALER,
  PIXEL_ART_SCALERS,
  type PixelArtScaler,
  parsePixelArtScaler,
} from './gpu/pixel-art/registry.js';
export { gpuAdapterName } from './gpu/pixi-app/gpu-adapter.js';
export { createGpuFrameTimer, type GpuFrameTimer, type GpuSpan } from './gpu/pixi-app/gpu-frame-timer.js';
export {
  atlasSourceFromBitmap,
  type BackingDensity,
  type BackingDensitySetting,
  createPixiApp,
  createWindowPixiApp,
  loadAtlasSource,
  parseBackingDensitySetting,
  resolveBackingDensity,
  windowResolutionFor,
} from './gpu/pixi-app/pixi-app.js';
export {
  bakeToSprite,
  oversampleFor,
  type SupersampledTexture,
} from './gpu/pixi-app/supersample.js';
export type { BerthMark, PlacementGhost } from './gpu/placement/ghost.js';
export type { OverlayBrush, PlacementOverlayCell, PlacementOverlayFrame } from './gpu/placement/overlay.js';
export type { PlanRoadTextures } from './gpu/placement/plan-road.js';
export type { PlanStakeTextures } from './gpu/placement/plan-stake.js';
export type { RangeRing } from './gpu/selection/range-ring.js';
export {
  DEFAULT_SELECTION_STYLE,
  parseSelectionStyle,
  SELECTION_STYLES,
  type SelectionStyle,
  type TargetFlash,
  type TargetFlashTone,
  type TargetTone,
} from './gpu/selection/style.js';
export { drawNightMaskPrograms, type NightMaskDraws, nightMaskSources } from './gpu/shaders/night-links.js';
export type { GlslProgramSource } from './gpu/shaders/program-source.js';
export { linkRendererPrograms, type RendererLink } from './gpu/shaders/renderer-links.js';
export {
  forgetShaderLinks,
  type ShaderWarmup,
  startShaderWarmup,
  type WarmedProgram,
  type WarmupSettings,
} from './gpu/shaders/warmup.js';
export {
  createPresentationTrack,
  type EntityBounds,
  type PresentationTrack,
  presentItem,
  type ResolvedLayer,
  resolveLayers,
  vehiclePalette,
} from './gpu/sprite-pool/index.js';
export { humanPaletteIdentity } from './gpu/sprite-pool/layers/human-palette-row.js';
export type { ClothIndexRanges } from './gpu/sway/cloth-wind.js';
export { flatTileColour, TerrainLayer } from './gpu/terrain/index.js';
export type {
  GroundPattern,
  TerrainTextureSet,
  TransitionPattern,
} from './gpu/terrain/textures.js';
export {
  type DrawableResource,
  isDrawableResource,
  readable2dContext,
} from './gpu/textures/drawable-resource.js';
export type { AnchorRect, ErasedRegion } from './gpu/textures/erased-frame-cache.js';
export { type HumanArmorPalettes, HumanPaletteLut, TEAM_HUMANS } from './gpu/textures/human-palette-lut.js';
export {
  colourRecolouredFrame,
  type DrawableFrame,
  drawableFrame,
  RecolouredPageSource,
  recolourOf,
  registerRecolouredFrames,
  registerRecolouredPageUploader,
} from './gpu/textures/recoloured-pages.js';
export {
  type CartDriveBinding,
  type PaletteLut,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SpriteLayer,
  type SpriteSheet,
  type VehicleColourLut,
  vehicleLutRow,
} from './gpu/textures/sprite-sheet.js';
export {
  createSyntheticAtlasSource,
  SYNTHETIC_BINDINGS,
  syntheticAtlasFrames,
} from './gpu/textures/synthetic-atlas.js';
export { TextureCache } from './gpu/textures/texture-cache.js';
export {
  SPRITE_CULL_MARGIN,
  type TargetMark,
  type WorldEnhancements,
  type WorldFrame,
  WorldRenderer,
  type WorldRendererOptions,
} from './gpu/world-renderer/index.js';
export type { MapViewFrame, MapViewTarget } from './gpu/world-views/map-view.js';
export type { PortraitInsetFrame } from './gpu/world-views/portrait-inset.js';
