import { Container, type Graphics, type Sprite } from 'pixi.js';
import type { SelectionEllipse } from '../../data/sprites/atlas.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { PalettedSprite } from '../paletted-sprite/index.js';
import type { PaletteLut } from '../sprite-sheet.js';
import { createPresentationTrack, type PresentationTrack } from './present-item.js';

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
interface PooledEntityBase extends PresentationTrack {
  readonly container: Container;
  placeholder?: Graphics;
  /** The plan stake standing on an unfinished palisade segment no builder has claimed yet. */
  palisadeSiteMarker?: Container;
  /** The same segment's stone ring once claimed, holding the builder's flag in place of the stake. */
  palisadeClaimRing?: Container;
  attached: boolean;
  /** The `frameId` this entity was last drawn on; −1 = never drawn. */
  lastSeen: number;
  /** The `frameId` a map view last drew this entity on while the main frame culled it; −1 = never. */
  viewSeen: number;
  /** This entity's world-space sprite AABB, restamped in place each frame it's drawn. */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  selectionEllipse: { -readonly [K in keyof SelectionEllipse]: SelectionEllipse[K] } | undefined;
}

/** A settler or an indexed vehicle, drawing team-coloured {@link PalettedSprite} meshes through its LUT. */
export interface PalettedPooledEntity extends PooledEntityBase {
  readonly paletted: true;
  readonly sprites: PalettedSprite[];
  /** This character's shadow silhouettes in resolved order, kept apart from the meshes: a silhouette
   *  draws palette-less, as a plain sprite under them. Grown as frames resolve them. */
  readonly shadows: Sprite[];
  readonly palette: PaletteLut;
}

/** Every other entity: its atlas layers are plain cached-sub-texture {@link Sprite}s. */
export interface PlainPooledEntity extends PooledEntityBase {
  readonly paletted: false;
  readonly sprites: Sprite[];
  /** Parallel to {@link PlainPooledEntity.sprites}: whether that layer is a cast shadow this frame, the
   *  pixel picker's exclusion. A paletted character keeps its shadow on a sprite of its own. */
  readonly shadowFlags: boolean[];
}

export type PooledEntity = PalettedPooledEntity | PlainPooledEntity;

/** A fresh, empty pooled entity; sprites and placeholder grow lazily, and a `palette` makes it the
 *  paletted (team-coloured mesh) variant. */
export function createPooled(kind: SpriteKind, palette: PaletteLut | undefined): PooledEntity {
  const base = {
    ...createPresentationTrack(kind),
    container: new Container(),
    attached: false,
    lastSeen: -1,
    viewSeen: -1,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    boundsFrame: -1,
    selectionEllipse: undefined,
  };
  return palette === undefined
    ? { ...base, paletted: false, sprites: [], shadowFlags: [] }
    : { ...base, paletted: true, sprites: [], shadows: [], palette };
}
