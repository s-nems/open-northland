/**
 * The terrain folder: the pure, Pixi-free half of drawing the ground — the mesh's node geometry
 * ({@link import('./tessellation.js')}), the pattern-page UV fold ({@link import('./uv.js')}), the
 * transition-lane decode ({@link import('./transitions.js')}), and the per-cell fields the mesh samples
 * (elevation lift, brightness, hillshade, the water wave). The twin of `gpu/terrain/`, so the vertex,
 * UV, and shading math is unit-tested headlessly.
 */

export { BRIGHTNESS_NEUTRAL, type BrightnessField, makeBrightnessField, scaleColour } from './brightness.js';
export { clampedCellAt, makeCellSampler } from './cell-field.js';
export {
  type ElevationField,
  elevationLiftPerUnit,
  makeElevationField,
  projectNode,
  terrainLiftAt,
  terrainLiftAtNode,
} from './elevation.js';
export { composeShadingLane } from './hillshade.js';
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
export { type CellTexture, patternSrcRect, rectTriangleUVs, type SrcRect, triangleUVs } from './uv.js';
export { makeWaveField, NO_WAVE, type NodeWaveFn } from './water.js';
