import { Container, type Graphics, type Sprite } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { PalettedSprite } from '../paletted-sprite/index.js';
import type { PlayerColourLut } from '../sprite-sheet.js';
import type { MotionTrack } from './motion.js';

/**
 * The retained per-entity state of the sprite pool: one {@link PooledEntity} per drawable entity,
 * kept across frames and mutated in place (the steady state allocates nothing).
 */

/**
 * The world-space axis-aligned bounding box of an entity's drawn sprite this frame (pre-camera, the same
 * space as a {@link import('../../data/scene/index.js').DrawItem}'s `x`/`y`). The union of its visible
 * atlas layers (or its placeholder box), translated to the feet anchor. This is what makes "click
 * anywhere on the graphic" and a footprint-sized selection marker exact per building/settler — the
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
interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * One entity's persistent display objects, kept across frames and reused: a {@link Container} at the
 * entity's feet anchor holding its atlas layer sprites (body + head overlays, or a single kind/family
 * sprite) and a lazily-built placeholder {@link Graphics}. Per frame only the container position, the
 * sprites' textures/offsets, and their visibility change — nothing is re-allocated.
 */
interface PooledEntityBase {
  readonly container: Container;
  readonly kind: SpriteKind;
  /** Per-{@link PooledEntity.sprites}-index: whether that layer is a cast shadow this frame — restamped
   *  by the {@link import('./bind-layers.js').LayerBinder}, read by the pixel hit test (a shadow must not
   *  make its caster clickable). */
  readonly shadowFlags: boolean[];
  placeholder?: Graphics;
  attached: boolean;
  /** The `frameId` this entity was last drawn on; −1 = never drawn. The reconcile detaches entities whose
   *  stamp is not the current frame, and snaps the motion track of one whose stamp skipped a frame. */
  lastSeen: number;
  /** This entity's world-space sprite AABB, restamped in place each frame it's drawn (no per-frame alloc). */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  /** Last real facing (0..7) this settler drew with — reused across the 1-tick heading gap a re-pathing
   *  unit shows, so its walk doesn't flip to the default facing for a frame each tile (see
   *  {@link import('./presentation.js').walkPose}). */
  lastFacing?: number;
  /** The displayed bottom-up reveal fraction (0..1) of an under-construction building, eased toward the
   *  sim's `built` each frame ({@link import('./presentation.js').easeReveal}). `undefined` until the
   *  entity first draws a reveal layer, and reset to `undefined` once it finishes. Always present (not
   *  optional) so an entity's shape never transitions when a reveal first appears; the pool holds
   *  exactly the union's two shapes, one per variant. */
  reveal: number | undefined;
  /** The entity's inter-tick motion track — the last two tick anchors plus the lerped drawn anchor
   *  ({@link import('./motion.js').trackMotion}); 12 Hz sim steps draw as continuous frame-rate motion.
   *  `tick` −1 = untracked (see {@link MotionTrack.tick}). */
  readonly motion: MotionTrack;
}

/** A settler drawing team-coloured {@link PalettedSprite} meshes. Carries the LUT its meshes are built
 *  from, so holding a paletted entity proves the palette loaded. Decided once at creation (the sheet
 *  never changes), which is what keeps `sprites` homogeneous. */
export interface PalettedPooledEntity extends PooledEntityBase {
  readonly paletted: true;
  readonly sprites: PalettedSprite[];
  readonly palette: PlayerColourLut;
}

/** Every other entity: its atlas layers are plain cached-sub-texture {@link Sprite}s. */
export interface PlainPooledEntity extends PooledEntityBase {
  readonly paletted: false;
  readonly sprites: Sprite[];
}

export type PooledEntity = PalettedPooledEntity | PlainPooledEntity;

/** A fresh, empty pooled entity (container + kind; sprites/placeholder grow lazily on first update).
 *  A `palette` makes it a paletted (team-coloured mesh) entity bound through that LUT. */
export function createPooled(kind: SpriteKind, palette: PlayerColourLut | undefined): PooledEntity {
  const base = {
    container: new Container(),
    kind,
    shadowFlags: [],
    attached: false,
    lastSeen: -1,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    boundsFrame: -1,
    reveal: undefined,
    motion: { tick: -1, x: 0, y: 0, prevX: 0, prevY: 0, drawX: 0, drawY: 0, gaitPhase: 0, stillTicks: 0 },
  };
  return palette === undefined
    ? { ...base, paletted: false, sprites: [] }
    : { ...base, paletted: true, sprites: [], palette };
}
