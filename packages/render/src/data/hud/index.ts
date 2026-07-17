/**
 * The HUD folder: the pure, Pixi-free pipeline from a frozen `WorldSnapshot` to placed screen text —
 * aggregation ({@link import('./model.js')} `buildHud`), then panel layout
 * ({@link import('./layout.js')} `layoutHud`), then screen-corner placement
 * ({@link import('./place.js')} `placeHud`). Each stage is a function of the previous stage's output, so
 * the whole chain is unit-tested headlessly and the GPU/DOM layer only paints the result.
 */

export { type HudLabels, type HudLayout, type HudTextRow, layoutHud } from './layout.js';
export { buildHud, type HudModel, IDLE_JOB, type JobCount, type StockCount } from './model.js';
export { type HudCorner, type HudPlacement, type HudScreen, placeHud } from './place.js';
