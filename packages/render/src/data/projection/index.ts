/**
 * The isometric projection, the camera transform, and the viewport-cull math inverted out of it -
 * Pixi-free, so every other `data/` folder and the GPU renderer can hang off it.
 *
 * Modules here import each other directly (`./iso.js`), never through this barrel: that cycle would
 * force a TDZ workaround.
 */

export {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  depthKey,
  halfCellToScreen,
  nodeDiamondPoly,
  ONE,
  rowStagger,
  screenToCell,
  snapCameraToDevicePixels,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
  tileToScreenX,
  tileToScreenY,
} from './iso.js';
export {
  aabbIntersects,
  type Box,
  cameraViewport,
  isVisible,
  type TileRange,
  type Viewport,
  visibleTileRange,
} from './viewport.js';
