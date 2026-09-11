import { Container, type Graphics, type Sprite } from 'pixi.js';
import type { SelectionEllipse } from '../../data/sprites/atlas.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { PalettedSprite } from '../paletted-sprite/index.js';
import type { PlayerColourLut } from '../sprite-sheet.js';
import { type MotionTrack, snapDistanceForKind } from './motion.js';

/** The world-space (pre-camera) axis-aligned box of an entity's drawn sprite this frame. */
export interface EntityBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * One entity's persistent display objects, reused across frames: a {@link Container} at the entity's feet
 * anchor holding its atlas layer sprites and a lazily-built placeholder {@link Graphics}. Per frame only
 * positions, textures and visibility change - nothing is re-allocated.
 */
interface PooledEntityBase {
  readonly container: Container;
  readonly kind: SpriteKind;
  /** Parallel to {@link PooledEntity.sprites}: whether that layer is a cast shadow this frame. */
  readonly shadowFlags: boolean[];
  placeholder?: Graphics;
  attached: boolean;
  /** The `frameId` this entity was last drawn on; −1 = never drawn. */
  lastSeen: number;
  /** This entity's world-space sprite AABB, restamped in place each frame it's drawn. */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  /** Last real facing (0..7) this settler drew with, reused across the one-tick heading gap a re-pathing
   *  unit shows. */
  lastFacing?: number;
  /** The displayed bottom-up reveal fraction (0..1) of an under-construction building, eased toward the
   *  sim's reported progress; `undefined` when nothing is in progress. Declared present rather than
   *  optional so the entity's shape never changes when a reveal first appears. */
  reveal: number | undefined;
  selectionEllipse: { -readonly [K in keyof SelectionEllipse]: SelectionEllipse[K] } | undefined;
  readonly motion: MotionTrack;
}

/** A settler drawing team-coloured {@link PalettedSprite} meshes through its own LUT. */
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

/** A fresh, empty pooled entity; sprites and placeholder grow lazily, and a `palette` makes it the
 *  paletted (team-coloured mesh) variant. */
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
    selectionEllipse: undefined,
    motion: {
      tick: -1,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      drawX: 0,
      drawY: 0,
      gaitPhase: 0,
      prevGaitPhase: 0,
      stillTicks: 0,
      snapDistance: snapDistanceForKind(kind),
    },
  };
  return palette === undefined
    ? { ...base, paletted: false, sprites: [] }
    : { ...base, paletted: true, sprites: [], palette };
}
