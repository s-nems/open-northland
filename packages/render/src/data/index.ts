/**
 * The pure, Pixi-free sub-barrel - isometric projection + the camera transform + viewport culling,
 * plus the minimap raster and the snapshot rules a non-render consumer must agree with the scene on,
 * with no GPU/canvas dependency. It exists so a non-render consumer (e.g. `@open-northland/audio`,
 * which spatialises sound by the same camera projection the renderer draws with, the asset pipeline,
 * which rasterises map thumbnails, or an app overlay projection that must skip the settlers the
 * scene hides) can import this without pulling the main `../index.js` barrel, which re-exports the
 * Pixi `WorldRenderer` and so drags Pixi into the importer's module graph.
 *
 * Every export is spelled out. This is a public package entry (`@open-northland/render/data`), so an
 * `export *` would publish whatever its modules happen to add - including the projection internals the
 * main barrel deliberately withholds, and `isVisible`, which stays render-only.
 */

export {
  aabbIntersects,
  type Box,
  type Camera,
  cameraViewport,
  halfCellToScreen,
  ONE,
  type TileRange,
  tileToScreen,
  type Viewport,
  visibleTileRange,
} from './projection/index.js';
export { isIndoorSettler } from './scene/snapshot-index.js';
export type { SceneGround } from './scene/terrain-scene.js';
export {
  averagePatternColour,
  cellColourResolver,
  cellColoursFromGround,
  MAP_PREVIEW_MAX_HEIGHT,
  MAP_PREVIEW_MAX_WIDTH,
  MINIMAP_CELL_UNRESOLVED,
  mapPreviewSize,
  rasterizeTerrain,
  type TerrainCells,
  terrainWorldBounds,
  type WorldBounds,
} from './terrain/minimap.js';
export { patternSrcRect, type SrcRect, texturePageKey } from './terrain/uv.js';
