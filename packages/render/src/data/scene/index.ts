/**
 * The pure scene-building layer — the part of rendering an agent can self-verify (no Pixi, no canvas,
 * no GPU). Split by concern:
 *  - {@link import('./draw-item.js')} — the {@link DrawItem} sprite vocabulary;
 *  - {@link import('./snapshot-readers/index.js')} — the per-component snapshot reads;
 *  - {@link import('./sprite-scene.js')} — the per-frame culled, depth-sorted sprite list + liveness set;
 *  - {@link import('./projectile-arc.js')} — the drawn shot's ballistic-arc trig;
 *  - {@link import('./terrain-scene.js')} — the terrain-grid shapes + map projection + headless oracle.
 */
export { type DrawItem, type DrawKind, paintOrderBias, type SpriteState } from './draw-item.js';
export { PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX } from './projectile-arc.js';
export { depositVisualLevel } from './snapshot-readers/index.js';
export { buildSpriteScene, collectSpriteScene, type SpriteScene } from './sprite-scene.js';
export { buildScene, type SceneGround, type SceneTerrain, terrainMapToScene } from './terrain-scene.js';
