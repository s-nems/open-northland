import type { Sprite } from 'pixi.js';
import type { BoundsUnion, LayerDrawBox } from './box.js';
import type { LayerStretch } from './resolved-layer.js';

/** Place `sprite` over `box` stretched about the box's middle: a thin shaft lengthens along its
 *  direction and thickens across it by factors of their own. */
export function placeStretched(
  sprite: Sprite,
  scale: number,
  box: LayerDrawBox,
  stretch: LayerStretch,
): void {
  const ux = Math.cos(stretch.along);
  const uy = Math.sin(stretch.along);
  const extra = stretch.by - stretch.across;
  // The stretch as a matrix over screen px: `across` everywhere plus `extra` of the projection onto the
  // direction.
  const xx = stretch.across + extra * ux * ux;
  const xy = extra * ux * uy;
  const yy = stretch.across + extra * uy * uy;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  sprite.position.set(box.ox + halfW - (xx * halfW + xy * halfH), box.oy + halfH - (xy * halfW + yy * halfH));
  // Pixi composes an unrotated sprite's matrix from a scale and a skew per axis.
  sprite.scale.set(scale * Math.hypot(xx, xy), scale * Math.hypot(xy, yy));
  sprite.skew.set(Math.atan2(xy, yy), Math.atan2(xy, xx));
}

/** Add `box` as {@link placeStretched} draws it: no corner leaves the box grown by the stretch. */
export function addStretchedBox(bounds: BoundsUnion, box: LayerDrawBox, stretch: LayerStretch): void {
  const grow = (Math.max(1, stretch.by, stretch.across) - 1) / 2;
  bounds.add(
    box.ox - grow * box.width,
    box.oy - grow * box.height,
    box.ox + (1 + grow) * box.width,
    box.oy + (1 + grow) * box.height,
  );
}
