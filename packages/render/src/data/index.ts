/**
 * The pure, Pixi-free math sub-barrel — isometric projection + the camera transform + viewport
 * culling, with no GPU/canvas dependency. It exists so a non-render consumer (e.g. `@open-northland/audio`,
 * which spatialises sound by the same camera projection the renderer draws with) can import this
 * math without pulling the main `../index.js` barrel, which re-exports the Pixi `WorldRenderer` and so
 * drags Pixi into the importer's module graph. The main barrel keeps re-exporting these too (for
 * render's own consumers); this is a narrower, dependency-light entry point onto the same modules.
 */

export * from './elevation.js';
export * from './iso.js';
// Explicit (not `export *`) so the internal-only `isVisible` predicate stays off the public surface —
// it mirrors the main barrel's viewport block. The rest are the Pixi-free cull math `@open-northland/audio`
// spatialises sound with.
export {
  aabbIntersects,
  type Box,
  cameraViewport,
  type TileRange,
  type Viewport,
  visibleTileRange,
} from './viewport.js';
