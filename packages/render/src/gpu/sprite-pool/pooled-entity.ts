import { Container, type Sprite } from 'pixi.js';
import type { SelectionEllipse } from '../../data/sprites/atlas.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { PalettedQuad, PalettedSprite } from '../paletted-sprite/index.js';
import type { SelectionGraphics, SelectionSprite } from '../sprite-selection-effect.js';
import type { PaletteLut } from '../sprite-sheet.js';
import { BindStamp } from './bind-stamp.js';
import { HumanPaletteRow } from './human-palette-row.js';
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
  placeholder?: SelectionGraphics;
  /** The plan marker on an unfinished wall segment or road site no builder has claimed yet: a stake or a
   *  pegged plot. */
  siteMarker?: Container;
  /** The same site's marker once claimed, holding the builder's flag: the stake's ring or the bare plot. */
  siteClaimMarker?: Container;
  attached: boolean;
  /** The `frameId` this entity was last drawn on; −1 = never drawn. */
  lastSeen: number;
  /** The `frameId` a map view last drew this entity on while the main frame culled it; −1 = never. */
  viewSeen: number;
  /** This entity's world-space sprite AABB, restamped in place each frame it's drawn. */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  /** The pool's hold generation while this entity holds still between visits: a kept scene item drawn by
   *  a held entity needs no present, and its last sighting and bounds stand for the current frame. −1 =
   *  not held. */
  held: number;
  selectionEllipse: { -readonly [K in keyof SelectionEllipse]: SelectionEllipse[K] } | undefined;
  readonly bound: BindStamp;
}

/** One team-coloured layer: a character's batched {@link PalettedQuad}, or a vehicle's self-placing
 *  {@link PalettedSprite} mesh, whose shader also rolls the hull and blows wind through the sail. */
export type PalettedLayerSprite = PalettedQuad | PalettedSprite;

/** A settler or an indexed vehicle, drawing its layers through its LUT. */
export interface PalettedPooledEntity extends PooledEntityBase {
  readonly paletted: true;
  readonly sprites: PalettedLayerSprite[];
  /** This character's shadow silhouettes in resolved order, kept apart from its layers: a silhouette
   *  draws palette-less, as a plain sprite under them. Grown as frames resolve them. */
  readonly shadows: Sprite[];
  readonly palette: PaletteLut;
  /** The body row the last bind read. */
  lutRow: number;
  /** This entity's row in the human LUT, while it draws through it. */
  readonly humanRow: HumanPaletteRow;
}

/** Every other entity: its atlas layers are plain cached-sub-texture {@link Sprite}s. */
export interface PlainPooledEntity extends PooledEntityBase {
  readonly paletted: false;
  readonly sprites: SelectionSprite[];
  /** Parallel to {@link PlainPooledEntity.sprites}: whether the pixel picker skips that layer this frame,
   *  as it does a cast shadow and a foot's ground cover. A paletted character keeps its shadow on a sprite
   *  of its own. */
  readonly pickExempt: boolean[];
}

export type PooledEntity = PalettedPooledEntity | PlainPooledEntity;

/** A fresh, empty pooled entity; sprites and placeholder grow lazily, and a `palette` makes it the
 *  paletted (team-coloured) variant. */
export function createPooled(kind: SpriteKind, palette: PaletteLut | undefined): PooledEntity {
  const base = {
    ...createPresentationTrack(kind),
    container: new Container(),
    attached: false,
    lastSeen: -1,
    viewSeen: -1,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    boundsFrame: -1,
    held: -1,
    selectionEllipse: undefined,
    bound: new BindStamp(),
  };
  return palette === undefined
    ? { ...base, paletted: false, sprites: [], pickExempt: [] }
    : {
        ...base,
        paletted: true,
        sprites: [],
        shadows: [],
        palette,
        lutRow: 0,
        humanRow: new HumanPaletteRow(),
      };
}
