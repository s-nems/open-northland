import type { Sprite } from 'pixi.js';

/**
 * How the world draws a shadow silhouette while the shadow enhancement is on. `alphaGain`, `maxAlpha`
 * and `tint` are compiled into the world batch shader; the rest is bind-time geometry.
 */
export interface ShadowStyle {
  /** Multiplies a silhouette's own coverage. The pipeline bakes `_s` silhouettes at alpha 0x50. */
  readonly alphaGain: number;
  /** Ceiling for the gained alpha, so an opaque body frame cast as a silhouette lands beside a
   *  gained `_s` blob instead of painting solid. */
  readonly maxAlpha: number;
  /** Shadow colour as 0xRRGGBB; replaces the silhouette's own black. */
  readonly tint: number;
  /** Screen px the cast silhouette moves right per px of caster height. */
  readonly castShear: number;
  /** How much of the caster's height the projection keeps: 1 would stand the silhouette back up. */
  readonly castFlatten: number;
  /** Draw the projected cast silhouette of a character or animal body frame. */
  readonly cast: boolean;
  /** Draw the authored `_s` twin silhouette of a character or animal - the original's foot blob. */
  readonly blob: boolean;
}

/**
 * Source basis: measured on the decoded `_s.shadow` silhouettes of the bobs whose footprint is small
 * enough that the silhouette is an unambiguous ground projection - `ls_wall` palisade posts, `ls_temp`
 * harbour beacons, `ls_guidepost`, `ls_stonehenge`, `ls_dungeon`. Best silhouette-overlap fit per family
 * lands at 0.35-0.55 px right and 0.18-0.45 px up per px of caster height. The chosen pair follows the
 * two families with the most pole-like frames, `ls_wall` at 0.35 over eight and `ls_temp` at 0.40 over
 * five, i.e. 32 degrees above the screen horizontal at 0.47x the caster's height; the wider families
 * rest on one or two frames each.
 *
 * The original is not internally consistent: `ls_statues`, `ls_trees`, `ls_goetter`, `ls_skeletons` and
 * every character body carry an undisplaced ground blob instead, and the largest `ls_houses_*` frames run
 * up to 0.75x. Strength and colour are named approximations, not measurements: the original bakes every
 * silhouette pure black at 0x50 alpha.
 */
export const DEFAULT_SHADOW_STYLE: ShadowStyle = {
  alphaGain: 1.8,
  maxAlpha: 0.58,
  tint: 0x1d2740,
  castShear: 0.4,
  castFlatten: 0.25,
  cast: true,
  blob: true,
};

/**
 * Place `sprite` as the ground projection of its own frame: sheared toward the light and flattened, both
 * about the drawing container's feet origin. `ox`/`oy` are the frame's already-scaled offset from that
 * origin, `scale` its art scale.
 */
export function setCastShadowTransform(
  sprite: Sprite,
  scale: number,
  style: ShadowStyle,
  ox: number,
  oy: number,
): void {
  const { castShear: shear, castFlatten: flatten } = style;
  // The shear/flatten matrix [[1, -shear], [0, flatten]] expressed in Pixi's skew + scale terms.
  sprite.skew.set(Math.atan2(-shear, flatten), 0);
  sprite.scale.set(scale, scale * Math.hypot(shear, flatten));
  sprite.position.set(ox - shear * oy, flatten * oy);
}
