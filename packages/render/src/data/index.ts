/**
 * The pure, Pixi-free sub-barrel (`@open-northland/render/data`): projection, camera, culling, the
 * minimap raster, and the snapshot rules a non-render consumer must agree with the scene on. Importing
 * the main `../index.js` barrel instead would drag Pixi into that consumer's module graph.
 *
 * Every export is spelled out because this is a public package entry: an `export *` would also publish
 * the projection internals the main barrel withholds, and render-only `isVisible`.
 */

export { type FrameIndexReader, RENDER_FRAME_INDEX_READERS } from './frame-indexes.js';
export { empireInventoryContains, empireInventoryOf, networkInventoryOf } from './hud/inventory.js';
export { stockCounts } from './hud/model.js';
export { gradeLuma, nightLevel, shownGrade } from './lighting/grade.js';
export { type LightGrade, NEUTRAL_GRADE } from './lighting/types.js';
export { buildMinimapCellField } from './minimap/cells.js';
export {
  changeMinimapObjectCounts,
  type MinimapFeature,
  type MinimapObjectChanges,
  type MinimapObjectCounts,
  type MinimapObjectLanes,
  type MinimapObjects,
  minimapFeatureOfGood,
  minimapLanesOfCounts,
  minimapObjectCounts,
  minimapObjectLanes,
} from './minimap/features.js';
export {
  applyMinimapGroundMode,
  MINIMAP_GROUND_MODES,
  type MinimapGroundMode,
} from './minimap/ground-mode.js';
export {
  averagePatternColour,
  cellColourResolver,
  cellColoursFromGround,
  MINIMAP_CELL_UNRESOLVED,
  mapPreviewSize,
  type TerrainCells,
  terrainWorldBounds,
  type WorldBounds,
} from './minimap/map-preview.js';
export {
  MINIMAP_DEPOSIT_KINDS,
  type MinimapDepositKind,
  type MinimapScene,
  minimapScene,
} from './minimap/scene.js';
export {
  changedMinimapTiles,
  MINIMAP_TILE_PX,
  rasterizeMinimap,
  rasterizeMinimapRegion,
} from './minimap/style.js';
export {
  aabbIntersects,
  type Box,
  type Camera,
  cameraViewport,
  halfCellToScreen,
  halfCellToScreenX,
  halfCellToScreenY,
  ONE,
  type TileRange,
  tileToScreen,
  type Viewport,
  visibleTileRange,
} from './projection/index.js';
export { anchorTileBox } from './scene/build/entity-source.js';
export type { ImportMarkerExemption } from './scene/import-markers.js';
export {
  indoorHouseOf,
  isIndoorSettler,
  type RoadShardView,
  roadRevisionOf,
  roadShardOf,
} from './scene/snapshot-index.js';
export { readEquipmentWeaponGood } from './scene/snapshot-readers/index.js';
export { type SceneGround, type SceneTerrain, terrainMapToScene } from './scene/terrain-scene.js';
export {
  linkedPosts,
  type OverlayPost,
  overlayPostsWithin,
  signpostOverlayIndex,
} from './signposts.js';
export type { AtlasFrame, SpriteAtlas } from './sprites/atlas.js';
export { GFX_DIR_TO_FACING, subClipKey } from './sprites/settler.js';
export type {
  CarryingBinding,
  CartDriveAnim,
  DirectionalAnim,
  FrameListAnim,
  SettlerStateBinding,
  SpriteFrameRef,
} from './sprites/settler-bindings.js';
export { patternSrcRect, type SrcRect, texturePageKey } from './terrain/uv.js';
export { type WaterCellFractions, waterCellFractions } from './terrain/water.js';
export {
  AMBIENT_LEVEL_AMOUNTS,
  AMBIENT_NO_WEATHER,
  type AmbientSectors,
  type AmbientWeatherNow,
  ambientAmount,
  buildAmbientField,
  variableWeather,
  winterWeather,
} from './weather/ambient.js';
export { THUNDER_MAX_DELAY_SECONDS, thunderDelaySeconds } from './weather/climate.js';
export {
  buildWeatherField,
  WEATHER_SECTOR_NODES,
  type WeatherField,
  weatherAmountAt,
} from './weather/field.js';
export type { LightningStrike, WeatherConditions, WeatherKind, WeatherRegionInput } from './weather/types.js';
export { WEATHER_DENSITY_FULL, WEATHER_KINDS } from './weather/types.js';
