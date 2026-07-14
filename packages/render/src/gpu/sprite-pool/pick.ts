import { Sprite } from 'pixi.js';
import { alphaMaskOf, maskSolidAt } from './alpha-mask.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';

/**
 * The read-only "what did the pool draw last frame" queries — the picker/selection/portrait side of
 * {@link import('./sprite-pool.js').SpritePool}, kept apart from the per-frame binding path. Each takes
 * the entity's {@link PooledEntity} (or `undefined` when it isn't pooled) plus the pool's current
 * `frameId`, and gates on the current frame's stamp so a pooled-but-culled entity reads as "not drawn"
 * (its stale stamp is ignored). Pure reads of the drawn graphic; no mutation, no Pixi scene changes.
 */

/**
 * The world-space bounding box of an entity's sprite as drawn last frame, or `undefined` if it wasn't
 * drawn (off-screen / not in the snapshot). The picker uses it for an exact "click the graphic" hit test
 * and the selection ring to size a building marker to its actual footprint — see {@link EntityBounds}.
 */
export function boundsOf(pe: PooledEntity | undefined, frameId: number): EntityBounds | undefined {
  // Only the current frame's stamp is valid: a pooled-but-culled entity keeps a stale stamp, so it
  // correctly reads as "no bounds" (off-screen → the picker falls back to its kind box).
  return pe !== undefined && pe.boundsFrame === frameId ? pe.bounds : undefined;
}

/**
 * Pixel-accurate refinement of the AABB hit: whether the world-px point `(wx, wy)` lands on a solid
 * texel of the entity's sprite as drawn last frame. Returns `undefined` when the exact answer isn't
 * available — entity not drawn this frame, a paletted (settler) mesh, a placeholder marker, or an
 * atlas whose pixels can't be read — so the caller keeps the box verdict; `false` means the point is
 * inside the box but on transparent pixels only (the "clicked next to the house" case the mask exists
 * to reject). See {@link alphaMaskOf} for the source basis (a deliberate deviation from the original's
 * footprint-cell picking).
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
  for (const spr of pe.sprites) {
    if (!(spr instanceof Sprite) || !spr.visible) continue;
    const mask = alphaMaskOf(spr.texture.source);
    if (mask === null) return undefined; // pixels unreadable → the box hit stands
    sampledEveryLayer = true;
    // World → this layer's frame-local texels: the container sits at the drawn anchor, the sprite at
    // its authored offset, scaled about the anchor (mirrors bindLayers' placement math, which only
    // ever sets a positive uniform scale). A non-positive scale would mean mirroring/degeneracy this
    // inverse can't map — fail soft to the box verdict rather than sample the wrong texels.
    const scale = spr.scale.x;
    if (!(scale > 0)) return undefined;
    const lx = Math.floor((wx - pe.motion.drawX - spr.position.x) / scale);
    const ly = Math.floor((wy - pe.motion.drawY - spr.position.y) / scale);
    const frame = spr.texture.frame;
    if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) continue;
    if (maskSolidAt(mask, frame.x + lx, frame.y + ly)) return true;
  }
  // Every visible layer had a mask and none was solid under the point → a genuine miss. No visible
  // atlas layer at all (placeholder marker showing) → no exact answer, keep the box.
  return sampledEveryLayer ? false : undefined;
}

/**
 * The anchor an entity was drawn at this frame — the inter-tick lerped feet position, not the raw
 * snapshot tile — or `undefined` when it wasn't drawn (culled / gone). The selection layer reads it so a
 * moving unit's ring glides with the interpolated bob instead of stepping at the tick rate.
 */
export function anchorOf(
  pe: PooledEntity | undefined,
  frameId: number,
): { x: number; y: number } | undefined {
  return pe !== undefined && pe.lastSeen === frameId ? { x: pe.motion.drawX, y: pe.motion.drawY } : undefined;
}
