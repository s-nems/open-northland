/** The pure scene-building layer: no Pixi, no canvas, no GPU. */

export { SceneItemMemo } from './build/item-memo.js';
export {
  buildSpriteScene,
  collectSpriteScene,
  IncrementalScene,
  isStaticItem,
  type LiveRefs,
  type SpriteScene,
} from './build/sprite-scene.js';
export { drawPassDepth, rowOfDepth, SHADOW_DEPTH_EPS, SIGN_DEPTH_EPS, screenDepth } from './depth.js';
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
export { type PalisadeLayout, palisadeLayoutOf } from './palisades/connections.js';
export { palisadeColumnShiftX } from './palisades/stagger.js';
export {
  BOW_LAUNCH_HEIGHT_PX,
  COVER_LAUNCH_HEIGHT_PX,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
  SHOT_STRIKE_HEIGHT_PX,
} from './projectiles/arc.js';
export {
  readSiegeShot,
  type ShotPath,
  type ShotPose,
  type SiegeShot,
  shotGroundLift,
  shotPath,
  shotPoseAt,
} from './projectiles/shot-flight.js';
export { type RoadChanges, RoadShardTracker } from './road-shards.js';
export {
  indoorHouseOf,
  isIndoorSettler,
  type RoadShardView,
  roadRevisionOf,
  roadShardOf,
  siegeShotsOf,
} from './snapshot-index.js';
export { depositVisualLevel, vehicleDrawTile } from './snapshot-readers/index.js';
export type { HouseBodyOf } from './temple-glow.js';
export { buildScene, type SceneGround, type SceneTerrain, terrainMapToScene } from './terrain-scene.js';
