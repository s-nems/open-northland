/** The Pixi-free half of drawing the ground, so the vertex, UV, and shading math is unit-tested
 *  headlessly. */

export { BRIGHTNESS_NEUTRAL, type BrightnessField, makeBrightnessField, scaleColour } from './brightness.js';
export { clampedCellAt, makeCellSampler } from './cell-field.js';
export {
  type ElevationField,
  elevationLiftPerUnit,
  makeElevationField,
  projectNode,
  projectTile,
  terrainLiftAt,
  terrainLiftAtNode,
} from './elevation.js';
export { composeShadingLane } from './hillshade.js';
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
} from './minimap.js';
export {
  cellNode,
  type NodeXY,
  nodeCell,
  nodeLaneUV,
  nodeLift,
  triangleANodes,
  triangleBNodes,
} from './tessellation.js';
export { TRANSITION_NONE, transitionRef } from './transitions.js';
export {
  type CellTexture,
  patternSrcRect,
  rectTriangleUVs,
  type SrcRect,
  texturePageKey,
  triangleUVs,
} from './uv.js';
export { makeWaterField, NO_WATER, type WaterField, type WaterNodeFn } from './water.js';
