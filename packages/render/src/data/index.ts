/**
 * The pure, Pixi-free sub-barrel (`@open-northland/render/data`): projection, camera, culling, the
 * minimap raster, and the snapshot rules a non-render consumer must agree with the scene on. Importing
 * the main `../index.js` barrel instead would drag Pixi into that consumer's module graph.
 *
 * Every export is spelled out because this is a public package entry: an `export *` would also publish
 * the projection internals the main barrel withholds, and render-only `isVisible`.
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
  MINIMAP_CELL_UNRESOLVED,
  mapPreviewSize,
  rasterizeTerrain,
  type TerrainCells,
  terrainWorldBounds,
  type WorldBounds,
} from './terrain/minimap.js';
export { patternSrcRect, type SrcRect, texturePageKey } from './terrain/uv.js';
