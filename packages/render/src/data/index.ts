/**
 * The PURE, Pixi-free math sub-barrel — isometric projection + the camera transform + viewport
 * culling, with no GPU/canvas dependency. It exists so a non-render consumer (e.g. `@vinland/audio`,
 * which spatialises sound by the same camera projection the renderer draws with) can import this
 * math WITHOUT pulling the main `../index.js` barrel, which re-exports the Pixi `WorldRenderer` and so
 * drags Pixi into the importer's module graph. The main barrel keeps re-exporting these too (for
 * render's own consumers); this is a narrower, dependency-light entry point onto the same modules.
 */

export * from './elevation.js';
export * from './iso.js';
export * from './viewport.js';
