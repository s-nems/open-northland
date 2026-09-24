import type { Sprite } from 'pixi.js';

/**
 * How the world draws a shadow silhouette while the shadow enhancement is on. `alphaGain`, `maxAlpha`
 * and `tint` are compiled into the world batch shader; the rest is bind-time geometry.
 */
export interface ShadowStyle {
  /** Multiplies a silhouette's own coverage. The pipeline bakes `_s` silhouettes at alpha 0x50. */
  readonly alphaGain: number;
  /** Ceiling for the gained alpha, so an opaque body frame cast as a silhouette lands beside a gained
   *  `_s` blob instead of painting solid. Once the gain carries full coverage past the ceiling, the
   *  ceiling alone sets both and only a soft-shadow bake's partial alpha still answers the gain. */
  readonly maxAlpha: number;
  /** Shadow colour as 0xRRGGBB: black-ish with a slight violet shift. A saturated or bright tint reads
   *  as a colour cast on the ground, which the accepted look rejects. */
  readonly tint: number;
  /** Screen px the cast silhouette moves right per px of caster height. */
  readonly castShear: number;
  /** How much of the caster's height the projection keeps: 1 would stand the silhouette back up. */
  readonly castFlatten: number;
}

/**
 * Projection source basis: measured on the decoded `_s.shadow` silhouettes of the bobs whose footprint is
 * small enough that the silhouette is an unambiguous ground projection - `ls_wall` palisade posts,
 * `ls_temp` harbour beacons, `ls_guidepost`, `ls_stonehenge`, `ls_dungeon`. Best silhouette-overlap fit
 * per family lands at 0.35-0.55 px right and 0.18-0.45 px up per px of caster height, and the original is
 * not internally consistent beyond it: `ls_statues`, `ls_trees`, `ls_goetter`, `ls_skeletons` and every
 * character body carry an undisplaced ground blob instead, while the largest `ls_houses_*` frames run up
 * to 0.75x. The chosen pair takes the readable end of that range, `ls_dungeon`'s 0.55 with a shallower
 * lift than its 0.45 - 29 degrees above the screen horizontal at 0.63x the caster's height - so a
 * character's projection, head included, reads as a directional shadow instead of hiding under the legs.
 *
 * Strength is an approximation chosen by eye, informed by the common 2D sprite practice of a black silhouette at
 * roughly half opacity; no measurement supports it. The pipeline bakes every silhouette pure black at
 * 0x50 alpha, itself an approximation rather than a match of the original's shadow
 * (tools/asset-pipeline/src/decoders/atlas/bake.ts), so the gain puts a baked blob at 0.502 and an
 * opaque body frame cast as a silhouette well past it: both land on the 0.50 ceiling. The colour departs from that pure black, sitting just off it
 * toward violet - the chosen look, following the pixel-art convention of shifting a shadow's hue toward
 * blue-violet rather than anything the original does.
 */
export const DEFAULT_SHADOW_STYLE: ShadowStyle = {
  alphaGain: 1.6,
  maxAlpha: 0.5,
  tint: 0x140b1a,
  castShear: 0.55,
  castFlatten: 0.3,
};

const CHANNEL_MAX = 0xff;

/** A {@link ShadowStyle.tint} as unit RGB, the form every shadow shader takes it in. */
export function shadowTintChannels(tint: number): readonly [number, number, number] {
  return [
    ((tint >> 16) & CHANNEL_MAX) / CHANNEL_MAX,
    ((tint >> 8) & CHANNEL_MAX) / CHANNEL_MAX,
    (tint & CHANNEL_MAX) / CHANNEL_MAX,
  ];
}

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
  sprite.scale.set(scale, scale * Math.sqrt(shear * shear + flatten * flatten));
  sprite.position.set(ox - shear * oy, flatten * oy);
}
