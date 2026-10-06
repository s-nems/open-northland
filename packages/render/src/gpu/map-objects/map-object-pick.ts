import { alphaMaskOf, maskSolidAt } from '../sprite-pool/alpha-mask.js';
import type { EntityBounds } from '../sprite-pool/pooled-entity.js';
import { type MapObjectSprite, objectFrameAt } from './map-object-sprite.js';

/**
 * Click geometry of a statically drawn map object, the counterpart of the sprite pool's `boundsOf` /
 * `pixelHit` for a harvestable the static layer still draws. Both read the pose shown at `tick` and
 * place it as the layer does: at the lifted feet, offset by the frame. Breeze shear is left out, a
 * named approximation of at most a few pixels at the crown.
 */

/** The world-px box of the object's pose at `tick`; `undefined` for an object with no frame. */
export function mapObjectBounds(obj: MapObjectSprite, tick: number): EntityBounds | undefined {
  const frame = objectFrameAt(obj, tick);
  if (frame === undefined) return undefined;
  const minX = obj.x + frame.offsetX * obj.scale;
  const minY = obj.y - (obj.lift ?? 0) + frame.offsetY * obj.scale;
  return {
    minX,
    minY,
    maxX: minX + frame.width * obj.scale,
    maxY: minY + frame.height * obj.scale,
  };
}

/**
 * Whether the world-px point lands on a solid texel of the object's pose at `tick`; `undefined` when
 * the sheet's pixels are unreadable, so the caller keeps its box verdict.
 */
export function mapObjectPixelHit(
  obj: MapObjectSprite,
  tick: number,
  wx: number,
  wy: number,
): boolean | undefined {
  const frame = objectFrameAt(obj, tick);
  if (frame === undefined || !(obj.scale > 0)) return undefined;
  const lx = Math.floor((wx - obj.x) / obj.scale - frame.offsetX);
  const ly = Math.floor((wy - obj.y + (obj.lift ?? 0)) / obj.scale - frame.offsetY);
  if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) return false;
  const mask = alphaMaskOf(obj.source);
  if (mask === null) return undefined;
  return maskSolidAt(mask, frame.x + lx, frame.y + ly);
}
