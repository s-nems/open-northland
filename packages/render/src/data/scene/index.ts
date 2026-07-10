/**
 * The PURE scene-building layer — the part of rendering an agent CAN self-verify (no Pixi, no canvas,
 * no GPU). Split by concern:
 *  - {@link import('./draw-item.js')} — the {@link DrawItem} vocabulary + terrain-grid shapes;
 *  - {@link import('./snapshot-readers.js')} — the per-component snapshot reads;
 *  - {@link import('./sprite-scene.js')} — the per-frame culled, depth-sorted sprite list + liveness set;
 *  - {@link import('./terrain-scene.js')} — the map projection + the whole-frame headless oracle.
 */
export {
  type DrawItem,
  type DrawKind,
  FLAG_PAINT_STEP,
  type SceneGround,
  type SceneTerrain,
  type SceneTransitions,
  SPRITE_PAINT_ORDER,
  type SpriteState,
} from './draw-item.js';
export { depositVisualLevel } from './snapshot-readers.js';
export {
  buildSpriteScene,
  collectSpriteScene,
  drawableEntityRefs,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
  type SpriteScene,
} from './sprite-scene.js';
export { buildScene, terrainMapToScene } from './terrain-scene.js';
