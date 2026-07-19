/**
 * The pure half of the combat-feedback layer: the sim's one-shot `combatHit` / `projectileHit` / `settlerDied`
 * events (each carrying a half-cell node) fold into a decaying list of render-only ground marks — blood where a
 * blow lands, bones where a unit falls. Decay is measured in sim ticks, not wall-clock, so a `?shot` capture and
 * a paused game reproduce exactly.
 *
 * The original's HIT particle (`logicdefines.inc` PARTICEL_EFFECT HIT 1) is unbound here, so the blood burst is a
 * named procedural approximation: droplets that spray from the wound and fall under gravity ({@link bloodDroplet}
 * owns the motion). Bones draw the decoded cadaver sprite (skeleton_falling → cadaver_skeleton) when the app
 * supplies it, else a procedural pile. The shapes are the GPU layer's; this module owns the decay, the droplet
 * motion, and the event→mark fold.
 */

export { BLOOD_RISE, bloodDroplet, frac } from './blood.js';
export {
  type BuildingCollapse,
  COLLAPSE_LIFETIME_TICKS,
  COLLAPSE_TICKS,
  collapseDustPuff,
  collapseKey,
  collapseProgress,
  DUST_PUFFS,
  DUST_SETTLE_TICKS,
  foldBuildingCollapses,
  MAX_ACTIVE_COLLAPSES,
} from './collapse.js';
export {
  BLOOD_LIFETIME_TICKS,
  BONES_LIFETIME_TICKS,
  type CombatEffect,
  type CombatEffectKind,
  effectAlpha,
  effectKey,
  foldCombatEffects,
  MAX_ACTIVE_EFFECTS,
} from './marks.js';
export {
  DAMAGE_SMOKE_STEP,
  damageSmokeEmitters,
  emitterSpot,
  MAX_SMOKE_EMITTERS,
  SMOKE_PUFF_PERIOD_TICKS,
  SMOKE_PUFFS_PER_EMITTER,
  SMOKE_RISE_PX,
  type SmokePuffPose,
  smokePuff,
} from './smoke.js';
