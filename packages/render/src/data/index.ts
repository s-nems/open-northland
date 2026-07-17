/**
 * The pure, Pixi-free math sub-barrel — isometric projection + the camera transform + viewport
 * culling, with no GPU/canvas dependency. It exists so a non-render consumer (e.g. `@open-northland/audio`,
 * which spatialises sound by the same camera projection the renderer draws with) can import this
 * math without pulling the main `../index.js` barrel, which re-exports the Pixi `WorldRenderer` and so
 * drags Pixi into the importer's module graph.
 *
 * Every export is spelled out. This is a public package entry (`@open-northland/render/data`), so an
 * `export *` would publish whatever its modules happen to add — including the projection internals the
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
