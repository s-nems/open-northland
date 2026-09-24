/** The pure scene-building layer: no Pixi, no canvas, no GPU. */
export { drawPassDepth, SHADOW_DEPTH_EPS, SIGN_DEPTH_EPS, screenDepth } from './depth.js';
export type {
  DrawItem,
  DrawKind,
  PalisadePostDraw,
  SpriteDrawItem,
  SpriteKind,
  SpriteState,
  VehicleDrawTask,
} from './draw-item.js';
export { type HolyFireBinding, type HolyFireLookup, holyFireOverlays } from './holy-fire.js';
export type { InHouseProgramLookup } from './in-house.js';
export { type PalisadeLayout, palisadeLayoutOf } from './palisade-connections.js';
export { palisadeStaggerX } from './palisade-stagger.js';
export {
  COVER_LAUNCH_HEIGHT_PX,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
} from './projectile-arc.js';
export {
  readSiegeShot,
  type ShotPath,
  type ShotPose,
  type SiegeShot,
  shotGroundLift,
  shotPath,
  shotPoseAt,
} from './shot-flight.js';
export { isIndoorSettler, siegeShotsOf } from './snapshot-index.js';
export { depositVisualLevel } from './snapshot-readers/index.js';
export { SpriteSpatialIndex } from './spatial-index.js';
export { buildSpriteScene, collectSpriteScene, type LiveRefs, type SpriteScene } from './sprite-scene.js';
export { buildScene, type SceneGround, type SceneTerrain, terrainMapToScene } from './terrain-scene.js';
