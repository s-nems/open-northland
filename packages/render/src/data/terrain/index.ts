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
  type TerrainCells,
  terrainWorldBounds,
  type WorldBounds,
} from './minimap.js';
export {
  type MinimapFeature,
  type MinimapObjectLanes,
  type MinimapObjects,
  minimapFeatureOfGood,
  minimapObjectLanes,
} from './minimap-features.js';
export {
  MINIMAP_DEPOSIT_KINDS,
  type MinimapDepositKind,
  type MinimapScene,
  minimapScene,
} from './minimap-scene.js';
export { rasterizeMinimap } from './minimap-style.js';
export {
  type Barycentric,
  cellsNearNode,
  type HalfTriangle,
  halfTrianglesA,
  halfTrianglesB,
  ROAD_GROUND_PATTERN,
  ROAD_TRANSITIONS,
  type RoadPaint,
  type RoadVariant,
  roadPaintOf,
  roadVariant,
  triangleRoadNodes,
} from './road-overlay.js';
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
export {
  makeWaterField,
  NO_WATER,
  paintsWater,
  type WaterCellFn,
  type WaterCellFractions,
  type WaterField,
  type WaterNodeFn,
  waterCellFractions,
  waterSurfaceAt,
} from './water.js';
