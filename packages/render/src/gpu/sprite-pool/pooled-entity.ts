import { Container, type Graphics, type Sprite } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { PalettedSprite } from '../paletted-sprite.js';
import type { MotionTrack } from './motion.js';

/**
 * The retained per-entity state of the sprite pool: one {@link PooledEntity} per drawable entity,
 * kept across frames and mutated in place (the steady state allocates nothing).
 */

/**
 * The WORLD-space axis-aligned bounding box of an entity's drawn sprite this frame (pre-camera, the same
 * space as a {@link import('../../data/scene/index.js').DrawItem}'s `x`/`y`). The union of its visible
 * atlas layers (or its placeholder box), translated to the feet anchor. This is what makes "click
 * anywhere on the graphic" and a footprint-sized selection marker EXACT per building/settler — the
 * picker + selection ring read it instead of guessing a fixed box, so a big headquarters and a small hut
 * each get a hit box the size of their own sprite.
 */
export interface EntityBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The mutable backing of an entity's bounds — one per pooled entity, restamped in place each frame so
 *  the per-frame bounds pass allocates nothing (see {@link PooledEntity.bounds}). */
export interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * One entity's persistent display objects, kept across frames and reused: a {@link Container} at the
 * entity's feet anchor holding its atlas layer {@link Sprite}s (body + head overlays, or a single
 * kind/family sprite) and a lazily-built placeholder {@link Graphics}. Per frame only the container
 * position, the sprites' textures/offsets, and their visibility change — nothing is re-allocated.
 */
export interface PooledEntity {
  readonly container: Container;
  readonly kind: SpriteKind;
  /** This entity's atlas layers. A PALETTED settler (team colours on) draws {@link PalettedSprite} meshes;
   *  every other entity draws plain {@link Sprite}s. Homogeneous per entity — set by {@link PooledEntity.paletted}. */
  readonly sprites: (Sprite | PalettedSprite)[];
  /** Whether this entity draws team-coloured {@link PalettedSprite} meshes (a settler, with a LUT + indexed
   *  characters loaded). Fixed at creation — the sprite CLASS can't change, so the pool decides once. */
  readonly paletted: boolean;
  placeholder?: Graphics;
  attached: boolean;
  lastSeen: number;
  /** This entity's world-space sprite AABB, restamped IN PLACE each frame it's drawn (no per-frame alloc). */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  /** Last real facing (0..7) this settler drew with — reused across the 1-tick heading gap a re-pathing
   *  unit shows, so its walk doesn't flip to the default facing for a frame each tile (see
   *  {@link import('./sprite-pool.js').SpritePool}). */
  lastFacing?: number;
  /** The DISPLAYED bottom-up reveal fraction (0..1) of an under-construction building, eased toward the
   *  layer's target each frame so the rise glides between the sim's per-swing `built` steps. `undefined`
   *  until the entity first draws a reveal layer, and reset to `undefined` once it finishes (no reveal
   *  layer). Always present (not optional) so the pooled entity keeps a stable, monomorphic shape. */
  reveal: number | undefined;
  /** The entity's inter-tick motion track — the last two TICK anchors plus the lerped DRAWN anchor
   *  ({@link import('./motion.js').trackMotion}); 20 Hz sim steps draw as continuous frame-rate motion.
   *  `tick` −1 = fresh. */
  readonly motion: MotionTrack;
}

/** A fresh, empty pooled entity (container + kind; sprites/placeholder grow lazily on first update). */
export function createPooled(kind: SpriteKind, paletted: boolean): PooledEntity {
  return {
    container: new Container(),
    kind,
    sprites: [],
    paletted,
    attached: false,
    lastSeen: 0,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    boundsFrame: -1,
    reveal: undefined,
    motion: { tick: -1, x: 0, y: 0, prevX: 0, prevY: 0, drawX: 0, drawY: 0 },
  };
}
