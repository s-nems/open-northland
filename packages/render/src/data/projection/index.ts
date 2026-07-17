/**
 * The projection folder: the isometric tile/half-cell → screen mapping, the camera transform, and the
 * viewport-cull math inverted back out of it. Dependency-light and Pixi-free — the layer every other
 * `data/` folder and the GPU renderer hang off.
 *
 * Modules here import each other directly (`./iso.js`), never through this barrel: `iso.ts` documents the
 * barrel↔module cycle that forces a TDZ workaround.
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
