import type { Sprite } from 'pixi.js';
import type { BoundsUnion, LayerDrawBox } from './box.js';
import type { LayerStretch } from './resolved-layer.js';

/** The stretch as a symmetric matrix over screen px: `across` everywhere plus `by - across` of the
 *  projection onto the direction. */
function stretchMatrix(stretch: LayerStretch): { xx: number; xy: number; yy: number } {
  const ux = Math.cos(stretch.along);
  const uy = Math.sin(stretch.along);
  const extra = stretch.by - stretch.across;
  return {
    xx: stretch.across + extra * ux * ux,
    xy: extra * ux * uy,
    yy: stretch.across + extra * uy * uy,
  };
}

/** Place `sprite` over `box` stretched about the box's middle: a thin shaft lengthens along its
 *  direction and thickens across it by factors of their own. */
export function placeStretched(
  sprite: Sprite,
  scale: number,
  box: LayerDrawBox,
  stretch: LayerStretch,
): void {
  const { xx, xy, yy } = stretchMatrix(stretch);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  sprite.position.set(box.ox + halfW - (xx * halfW + xy * halfH), box.oy + halfH - (xy * halfW + yy * halfH));
  setStretchedScale(sprite, scale, stretch);
}

/** Stretch `sprite` about its anchor; its `rotation` then turns the stretched shaft as a whole. */
export function setStretchedScale(sprite: Sprite, scale: number, stretch: LayerStretch): void {
  const { xx, xy, yy } = stretchMatrix(stretch);
  // Pixi composes the sprite's matrix from a scale and a skew per axis.
  sprite.scale.set(scale * Math.hypot(xx, xy), scale * Math.hypot(xy, yy));
  sprite.skew.set(Math.atan2(xy, yy), Math.atan2(xy, xx));
}

/** Add the quad {@link placeStretched} draws over `box`. */
export function addStretchedBox(bounds: BoundsUnion, box: LayerDrawBox, stretch: LayerStretch): void {
  const { xx, xy, yy } = stretchMatrix(stretch);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const cx = box.ox + halfW;
  const cy = box.oy + halfH;
  const reachX = Math.abs(xx) * halfW + Math.abs(xy) * halfH;
  const reachY = Math.abs(xy) * halfW + Math.abs(yy) * halfH;
  bounds.add(cx - reachX, cy - reachY, cx + reachX, cy + reachY);
}
