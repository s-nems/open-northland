import { Sprite } from 'pixi.js';
import { alphaMaskOf, maskSolidAt } from './alpha-mask.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';

/**
 * Read-only queries over what the pool drew this frame: no mutation, no Pixi scene changes. Each gates on
 * the current `frameId`, so a pooled-but-culled entity reads as "not drawn".
 */

/**
 * The drawn, terrain-lifted sprite geometry, implemented by the pool. An overlay riding it must draw
 * after the pool's reconcile and must not hold the answers past the frame.
 */
export interface DrawnGeometry {
  readonly boundsOf: (ref: number) => EntityBounds | undefined;
  readonly anchorOf: (ref: number) => { x: number; y: number } | undefined;
}

/** One drawn, damaged finished building: its ref and the remaining Health fraction the smoke reads. */
export interface DamagedBuilding {
  readonly ref: number;
  readonly hpFrac: number;
}

/** The world-space bounding box of an entity's sprite as drawn this frame; `undefined` leaves the picker
 *  on its kind box. */
export function boundsOf(pe: PooledEntity | undefined, frameId: number): EntityBounds | undefined {
  return pe !== undefined && pe.boundsFrame === frameId ? pe.bounds : undefined;
}

/**
 * Whether the world-px point `(wx, wy)` lands on a solid texel of the entity's sprite. `undefined` means
 * no exact answer is available and the caller keeps its box verdict; `false` means the point is inside
 * the box but on transparent pixels only.
 */
export function pixelHit(
  pe: PooledEntity | undefined,
  frameId: number,
  wx: number,
  wy: number,
): boolean | undefined {
  if (pe === undefined || pe.boundsFrame !== frameId) return undefined;
  if (pe.paletted) return undefined; // settler meshes keep the (deliberately generous) box hit
  // An under-construction site keeps the box hit too: its drawn pixels are the partial reveal, and a
  // player clicks the site (its final-building rect), not whatever scattered pixels exist so far.
  if (pe.reveal !== undefined) return undefined;
  let sampledEveryLayer = false;
  for (let i = 0; i < pe.sprites.length; i++) {
    const spr = pe.sprites[i];
    if (!(spr instanceof Sprite) || !spr.visible) continue;
    if (pe.shadowFlags[i] === true) continue;
    const mask = alphaMaskOf(spr.texture.source);
    if (mask === null) return undefined; // pixels unreadable → the box hit stands
    sampledEveryLayer = true;
    // World → this layer's frame-local texels, inverting the layer binder's placement, which only ever
    // sets a positive uniform scale. A non-positive one would be a mirroring this inverse cannot map, so
    // fail soft to the box verdict rather than sample the wrong texels.
    const scale = spr.scale.x;
    if (!(scale > 0)) return undefined;
    const lx = Math.floor((wx - pe.motion.drawX - spr.position.x) / scale);
    const ly = Math.floor((wy - pe.motion.drawY - spr.position.y) / scale);
    const frame = spr.texture.frame;
    if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) continue;
    if (maskSolidAt(mask, frame.x + lx, frame.y + ly)) return true;
  }
  // No visible atlas layer at all (a placeholder marker) leaves no exact answer, so keep the box.
  return sampledEveryLayer ? false : undefined;
}

/** The feet position an entity was drawn at this frame, not its raw snapshot tile, so an overlay reading
 *  it moves exactly as the sprite does. */
export function anchorOf(
  pe: PooledEntity | undefined,
  frameId: number,
): { x: number; y: number } | undefined {
  return pe !== undefined && pe.lastSeen === frameId ? { x: pe.motion.drawX, y: pe.motion.drawY } : undefined;
}
