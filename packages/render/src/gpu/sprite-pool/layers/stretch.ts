import type { Sprite } from 'pixi.js';
import type { BoundsUnion, LayerDrawBox } from './box.js';
import type { LayerStretch } from './resolved-layer.js';

/**
 * Place `sprite` over `box` drawn `stretch.by` times as long along `stretch.along`, about the box's
 * middle. The stretch runs along one screen direction only, so a thin shaft lengthens without thickening.
 */
export function placeStretched(
  sprite: Sprite,
  scale: number,
  box: LayerDrawBox,
  stretch: LayerStretch,
): void {
  const ux = Math.cos(stretch.along);
  const uy = Math.sin(stretch.along);
  const extra = stretch.by - 1;
  // The stretch as a matrix over screen px: identity plus `extra` of the projection onto the direction.
  const xx = 1 + extra * ux * ux;
  const xy = extra * ux * uy;
  const yy = 1 + extra * uy * uy;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  sprite.position.set(box.ox + halfW - (xx * halfW + xy * halfH), box.oy + halfH - (xy * halfW + yy * halfH));
  // Pixi composes an unrotated sprite's matrix from a scale and a skew per axis.
  sprite.scale.set(scale * Math.hypot(xx, xy), scale * Math.hypot(xy, yy));
  sprite.skew.set(Math.atan2(xy, yy), Math.atan2(xy, xx));
}

/** Add `box` as {@link placeStretched} draws it: no corner leaves the box grown by the stretch. */
export function addStretchedBox(bounds: BoundsUnion, box: LayerDrawBox, stretch: LayerStretch): void {
  const grow = (Math.max(1, stretch.by) - 1) / 2;
  bounds.add(
    box.ox - grow * box.width,
    box.oy - grow * box.height,
    box.ox + (1 + grow) * box.width,
    box.oy + (1 + grow) * box.height,
  );
}
