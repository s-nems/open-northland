import { Sprite } from 'pixi.js';
import type { SelectionEllipse } from '../../data/sprites/atlas.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { alphaMaskOf, maskSolidAt } from './alpha-mask.js';
import { keelLine } from './keel-line.js';
import type { EntityBounds, PalettedPooledEntity, PooledEntity } from './pooled-entity.js';

/**
 * Read-only queries over what the pool drew this frame: no mutation, no Pixi scene changes. Each gates on
 * the current `frameId`, so a pooled-but-culled entity reads as "not drawn".
 */

/**
 * The drawn, terrain-lifted sprite geometry, implemented by the pool. An overlay riding it must draw
 * after the pool's reconcile and must not hold the answers past the frame.
 */
export interface DrawnGeometry {
  /** Ground ellipse in feet-local world pixels. */
  readonly selectionOf?: (ref: number) => SelectionEllipse | undefined;
  readonly boundsOf: (ref: number) => EntityBounds | undefined;
  readonly anchorOf: (ref: number) => { x: number; y: number } | undefined;
  /** A drawn ship's keel line ({@link keelOf}), valid until the next call. */
  readonly keelOf?: (ref: number) => readonly number[] | undefined;
}

/** One drawn, damaged finished building: its ref and the remaining Health fraction the smoke reads. */
export interface DamagedBuilding {
  readonly ref: number;
  readonly hpFrac: number;
}

/** One drawn ship, at sea or moored, the input of the wake it pushes. */
export interface ShipAfloat {
  readonly ref: number;
  /** The drawn render facing. */
  readonly facing: number;
  readonly sailing: boolean;
}

/**
 * A drawn indexed ship's keel line ({@link keelLine}) as anchor-relative world px `(x, y)` pairs written
 * into `out`, for the hull at rest on the water: the heave and roll its sway adds are left out.
 * `undefined` when the body is not drawn this frame or its pixels are unreadable.
 */
export function keelOf(
  pe: PooledEntity | undefined,
  frameId: number,
  out: number[],
): readonly number[] | undefined {
  if (pe === undefined || pe.lastSeen !== frameId || !pe.paletted) return undefined;
  // A vehicle's silhouette lives in `pe.shadows`, so its first mesh is the body.
  const body = pe.sprites[0];
  if (!(body instanceof PalettedSprite)) return undefined;
  const frame = body.frame;
  const source = body.frameSource;
  if (!body.visible || frame === undefined || source === undefined) return undefined;
  const mask = alphaMaskOf(source);
  if (mask === null) return undefined;
  const keel = keelLine(mask, frame);
  const scale = body.artScale;
  out.length = keel.length;
  for (let i = 0; i + 1 < keel.length; i += 2) {
    out[i] = body.artDx + (frame.offsetX + (keel[i] ?? 0)) * scale;
    out[i + 1] = (frame.offsetY + (keel[i + 1] ?? 0)) * scale;
  }
  return out;
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
  if (pe.paletted) {
    // A settler keeps the (deliberately generous) box hit; a ship's sail box is mostly air.
    return pe.kind === 'settler' ? undefined : palettedPixelHit(pe, wx, wy);
  }
  // An under-construction site keeps the box hit too: its drawn pixels are the partial reveal, and a
  // player clicks the site (its final-building rect), not whatever scattered pixels exist so far.
  if (pe.reveal !== undefined) return undefined;
  let sampledEveryLayer = false;
  for (let i = 0; i < pe.sprites.length; i++) {
    const spr = pe.sprites[i];
    if (!(spr instanceof Sprite) || !spr.visible) continue;
    if (pe.pickExempt[i] === true) continue;
    const mask = alphaMaskOf(spr.texture.source);
    if (mask === null) return undefined; // pixels unreadable → the box hit stands
    sampledEveryLayer = true;
    // The binder preserves vertical scale when shearing vegetation around its root.
    const scale = spr.scale.x;
    if (!(scale > 0)) return undefined;
    const dy = wy - pe.motion.drawY - spr.position.y;
    const lx = Math.floor((wx - pe.motion.drawX - spr.position.x - dy * Math.tan(spr.skew.x)) / scale);
    const ly = Math.floor(dy / scale);
    const frame = spr.texture.frame;
    if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) continue;
    if (maskSolidAt(mask, frame.x + lx, frame.y + ly)) return true;
  }
  // No visible atlas layer at all (a placeholder marker) leaves no exact answer, so keep the box.
  return sampledEveryLayer ? false : undefined;
}

/** {@link pixelHit} over a vehicle's self-placing meshes, whose frame sits at its draw offset from the feet
 *  anchor. */
function palettedPixelHit(pe: PalettedPooledEntity, wx: number, wy: number): boolean | undefined {
  let sampledEveryLayer = false;
  for (let i = 0; i < pe.sprites.length; i++) {
    const spr = pe.sprites[i];
    // A vehicle's meshes; its silhouettes live in `pe.shadows`, never here.
    if (!(spr instanceof PalettedSprite) || !spr.visible) continue;
    const frame = spr.frame;
    const mask = spr.frameSource === undefined ? null : alphaMaskOf(spr.frameSource);
    if (frame === undefined || mask === null) return undefined;
    sampledEveryLayer = true;
    const scale = spr.artScale;
    if (!(scale > 0)) return undefined;
    const ny = (wy - pe.motion.drawY - spr.artDy) / scale;
    const nx = (wx - pe.motion.drawX - spr.artDx) / scale - spr.shear * ny;
    const lx = Math.floor(nx - frame.offsetX);
    const ly = Math.floor(ny - frame.offsetY);
    if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) continue;
    if (maskSolidAt(mask, frame.x + lx, frame.y + ly)) return true;
  }
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
