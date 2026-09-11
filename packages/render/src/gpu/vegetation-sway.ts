import type { Sprite } from 'pixi.js';

/** Artistic breeze approximation: a bounded shear around the ground anchor, independent of sim state. */
export function vegetationShear(tick: number, x: number, y: number, strength: number): number {
  const phase = x * 0.013 + y * 0.009;
  return strength * (0.75 * Math.sin(tick * 0.055 + phase) + 0.25 * Math.sin(tick * 0.11 + phase));
}

export function setVegetationShear(sprite: Sprite, scale: number, shear: number): void {
  sprite.skew.x = Math.atan(shear);
  sprite.scale.set(scale, scale * Math.hypot(1, shear));
}
