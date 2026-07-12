/**
 * The PURE scene-building layer — the part of rendering an agent CAN self-verify (no Pixi, no canvas,
 * no GPU). Split by concern:
 *  - {@link import('./draw-item.js')} — the {@link DrawItem} vocabulary + terrain-grid shapes;
 *  - {@link import('./snapshot-readers/index.js')} — the per-component snapshot reads;
 *  - {@link import('./sprite-scene.js')} — the per-frame culled, depth-sorted sprite list + liveness set;
 *  - {@link import('./projectile-arc.js')} — the drawn shot's ballistic-arc trig;
 *  - {@link import('./terrain-scene.js')} — the map projection + the whole-frame headless oracle.
 */
export {
  type DrawItem,
  type DrawKind,
  paintOrderBias,
  type SceneGround,
  type SceneTerrain,
  type SceneTransitions,
  type SpriteState,
} from './draw-item.js';
export { PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX } from './projectile-arc.js';
export { depositVisualLevel } from './snapshot-readers/index.js';
export {
  buildSpriteScene,
  collectSpriteScene,
  type SpriteScene,
  type SpriteSceneOptions,
} from './sprite-scene.js';
export { buildScene, terrainMapToScene } from './terrain-scene.js';
