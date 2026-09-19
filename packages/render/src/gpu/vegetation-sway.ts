import type { Sprite } from 'pixi.js';

/** Artistic breeze approximation: a bounded shear around the ground anchor, independent of sim state. */
export function vegetationShear(tick: number, x: number, y: number, strength: number): number {
  const phase = x * 0.013 + y * 0.009;
  return strength * (0.75 * Math.sin(tick * 0.055 + phase) + 0.25 * Math.sin(tick * 0.11 + phase));
}

/** Approximation: how many times flatter than its caster a silhouette may be and still read as that
 *  caster's projection. A flatter one lies under the body, and the shear it would need sweeps its rows
 *  across the ground. The original's still trees cast at about one sixth of their height. */
const MAX_SHADOW_FLATTENING = 8;

/**
 * The shear that carries a ground silhouette's far edge as far as its caster's top travels. `bodyTop`
 * and `shadowTop` are the two frames' `offsetY`, negative above the feet. Approximation: it reads the
 * authored silhouette as the body flattened onto the ground, so height along the body maps linearly to
 * depth along the shadow. The shear pivots at the feet, so rows a silhouette paints below them drift the
 * other way, and a silhouette that reaches no further than the feet stays put.
 */
export function castShadowShear(bodyShear: number, bodyTop: number, shadowTop: number): number {
  if (shadowTop >= 0) return 0;
  return bodyShear * Math.min(bodyTop / shadowTop, MAX_SHADOW_FLATTENING);
}

export function setVegetationShear(sprite: Sprite, scale: number, shear: number): void {
  sprite.skew.x = Math.atan(shear);
  sprite.scale.set(scale, scale * Math.hypot(1, shear));
}
