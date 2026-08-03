export type DrawKind =
  | 'tile'
  | 'building'
  | 'settler'
  | 'resource'
  | 'berrybush'
  | 'stockpile'
  | 'stump'
  | 'grounddrop'
  | 'signpost'
  | 'projectile';

/** Every kind that comes from an entity; a terrain tile comes from the grid instead. */
export type SpriteKind = Exclude<DrawKind, 'tile'>;

/** A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 *  `tribetypes` `setatomic` maps an atomic to its animation). */
export type SpriteState = 'idle' | 'moving' | 'acting';

/**
 * The subset of a building / resource / stump's draw fields a fog ghost keeps from its last sighting.
 * A kind's live-only extras stay on `DrawItem`, so a ghost carries none. Mutable so the readers assign
 * in place; `DrawItem` re-exposes them readonly.
 */
export interface StaticDrawFields {
  /** The type id a per-type binding picks its frame by: a tile's landscape typeId, or a building's
   *  `Building.buildingType` (the `[GfxHouse]` `LogicType`). Omitted for settler/resource. */
  typeId?: number;
  /**
   * For an under-construction building: build progress as a whole percent (0..99, floored
   * `Building.built`), which picks the `[GfxHouse]` layers showing at this stage. Omitted for a
   * finished building (`built >= ONE`) and non-building kinds.
   */
  builtPct?: number;
  /** A resource node's `Resource.goodType`, or the good a stockpile pile mainly holds. Omitted for a
   *  delivery flag and an empty pile, which draw the flag rather than a heap. */
  goodType?: number;
  /** A mined deposit's or crop's visual fill level in `[1, levels]`, stepping down from `levels` as it
   *  empties. Omitted for a plain node, which draws its full-state frame. */
  level?: number;
  /**
   * The {@link level} ladder's denominator (`MineDeposit.levels` or a crop's `stages`). The resolver
   * rescales the ladder onto the bound record's own authored frame count when they differ, so a full
   * deposit always draws its fullest frame. Must travel with {@link level}, which would otherwise
   * redraw at a different frame.
   */
  levels?: number;
  /** A resource node's `Resource.gfxIndex`: the exact `[GfxLandscape]` record it was spawned from, so a
   *  map keeps its species variety. Omitted for an admin/scene-spawned node. */
  gfxIndex?: number;
}

/**
 * One item to draw, already projected to isometric screen space, before the camera transform. The GPU
 * layer draws these in array order.
 */
export interface DrawItem extends Readonly<StaticDrawFields> {
  readonly kind: DrawKind;
  /** Source entity id, or the cell id for a terrain tile. */
  readonly ref: number;
  /** Isometric screen position of the item's anchor: tile centre for tiles, feet for sprites. */
  readonly x: number;
  readonly y: number;
  /** The sort key the item was ordered by. */
  readonly depth: number;
  /** For a stockpile pile: units of {@link goodType} held, which grows the drawn heap with its
   *  contents. Omitted for an empty pile (a flag) and non-stockpile kinds. */
  readonly fill?: number;
  /** For a stockpile: a designated delivery flag rather than a loose pile - a marker holding no goods,
   *  painted a hair above any co-located heap. Omitted for a loose pile and non-stockpiles. */
  readonly isFlag?: boolean;
  /** For a `signpost` board item: an index into the binding's 20°-step board frames around the post
   *  top. Omitted for the post itself. */
  readonly boardIndex?: number;
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /** For an `acting` sprite: whole ticks in its current atomic so far (`CurrentAtomic.elapsed`). A
   *  binding advances one frame per `ticksPerFrame` of these, so every action animates at the same
   *  cadence. Omitted when idle. */
  readonly elapsed?: number;
  /**
   * For a settler: facing direction index (0..7) a directional binding indexes by. The `CR_Hum_Body`
   * blocks are not a uniform rotation (source basis "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE, 4 E,
   * 5 SE, 6 S, 7 N`. Omitted when not moving, which draws the binding's default facing.
   */
  readonly facing?: number;
  /** For a settler: hauling a good (`Carrying` present). Orthogonal to {@link state}, since a settler
   *  can carry while `moving` or `acting`; the loaded gait replaces the empty-handed one (the
   *  original's `..._walk_wood` instead of `..._walk`). Omitted when carrying nothing. */
  readonly carrying?: boolean;
  /** For a {@link carrying} settler: the hauled `Carrying.goodType`, which draws the matching load. */
  readonly carryGood?: number;
  /** For a settler: combat-engaged (`Engagement` present). Orthogonal to {@link state}: the readied
   *  `..._agressive` gait replaces the relaxed economy one, though a bound attack swing still wins
   *  mid-swing. Omitted when not fighting. */
  readonly engaged?: boolean;
  /** For a settler: its `Settler.jobType`, the body/head look key (the original's `[jobbasegraphics]`
   *  job → body/head join). Omitted when the settler has no job, which draws the default look. */
  readonly jobType?: number;
  /** For a settler: its `Settler.tribe`, the species key for a wildlife entity - an animal is a settler
   *  of an animal tribe with a null `jobType`. Carried for every settler, unused by human bindings. */
  readonly tribe?: number;
  /**
   * For a settler: the `typeId` of the good in its `Equipment.weapon` slot, so the drawn weapon follows
   * the slot rather than the job. `null` when the settler carries an `Equipment` whose weapon slot is
   * empty, which draws a warrior job's bare-hands body. Omitted when the settler has no `Equipment` at
   * all, which leaves the {@link jobType} look standing, weapon and all.
   */
  readonly weaponGood?: number | null;
  /** {@link weaponGood}'s twin for the `Equipment.armor` slot, the armor-recolor key, same tri-state. */
  readonly armorGood?: number | null;
  /**
   * For a settler/signpost: the team-colour slot - the row of the `256×N` colour LUT a `PalettedSprite`
   * reads its clothing-band indices through, and the signpost's baked per-colour atlas. Defaults to the
   * owning `Owner.player` slot, or carries the mapped colour when the scene was built with a
   * `playerColourOf`. Omitted for an unowned settler, which draws the base palette (LUT row 0).
   */
  readonly player?: number;
  /** For a settler: born young (`Age` present), the only thing separating the age-class `jobType` ids
   *  1..4 from a synthetic fixture's colliding adult job ids. Omitted for adults. */
  readonly young?: boolean;
  /**
   * For a building upgrading into its next level: upgrade progress as a whole percent (0..99, floored
   * `Building.built`). Distinct from {@link builtPct}, since an upgrading building keeps its finished
   * old-tier body and the next tier's overlay (the `[GfxHouse]` `upgrade === 1` rows) reveals over it at
   * this progress. Omitted for a finished building, a from-scratch site, and non-building kinds.
   */
  readonly upgradePct?: number;
  /**
   * For a finished building: mid production cycle (`Production` present), which switches on an animated
   * state overlay such as the mill's rotor. Approximation of the original's overlay state 1:
   * `Production` persists through a brief worker-away pause, whose exact behaviour is unobserved.
   * Omitted for an idle workplace and non-building kinds.
   */
  readonly working?: boolean;
  /** For a finished, damaged building: its remaining Health fraction (0..1, exclusive of 1), which
   *  drives the damage-smoke overlay. Omitted for sites, upgrades, and non-building kinds. */
  readonly hpFrac?: number;
  /** For a projectile: flight heading in screen space (radians, 0 = screen-east, clockwise), tilted
   *  along the drawn arc's tangent when the launch origin is readable. */
  readonly rotation?: number;
  /** A remembered static drawn from the viewer's fog memory rather than a live entity. It draws dimmed
   *  and stamps no hit bounds, so clicking scenery intel cannot select a fogged, possibly dead,
   *  entity. */
  readonly ghost?: boolean;
  /** The draw-height lift at this item's feet in world px (≥ 0, terrain elevation plus a projectile's
   *  arc height), subtracted from the drawn `y`. The anchor and {@link depth} stay pre-lift, so a
   *  lifted sprite still occludes by feet row. Omitted on a flat map with nothing in flight. */
  readonly lift?: number;
  /** This item only survived the cull as the details-panel portrait's subject. It stays reconciled and
   *  paletted for the portrait's own render but is hidden on the main map, so an indoor settler cannot
   *  pop into view at its workplace door. */
  readonly portraitOnly?: boolean;
  /** Freeze this settler's animation clock to a fixed standing frame rather than the breathing idle
   *  loop. Set on every settler drawn while inside a building. */
  readonly frozen?: boolean;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled: fields are
 *  conditionally assigned rather than conditionally spread, since a spread per optional field
 *  allocates a throwaway object at thousands of sprites × 60 fps. */
export type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };

export interface SpriteDrawItem extends DrawItem {
  readonly kind: SpriteKind;
}

export type MutableSpriteDrawItem = { -readonly [K in keyof SpriteDrawItem]: SpriteDrawItem[K] };
