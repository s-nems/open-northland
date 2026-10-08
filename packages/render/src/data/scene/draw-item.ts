import type { InHouseClip } from './in-house.js';

export type DrawKind =
  | 'tile'
  | 'building'
  | 'palisade'
  | 'roadsite'
  | 'settler'
  | 'fish'
  | 'resource'
  | 'berrybush'
  | 'chest'
  | 'stockpile'
  | 'stump'
  | 'grounddrop'
  | 'signpost'
  | 'projectile'
  | 'vehicle'
  | 'craftfx';

export type SpriteKind = Exclude<DrawKind, 'tile'>;

/** The kinds a snapshot entity classifies as. A `craftfx` item is staged by a worker's in-house program
 *  beside that worker, never read off an entity of its own. */
export type EntityKind = Exclude<SpriteKind, 'craftfx'>;

/** A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 *  `tribetypes` `setatomic` maps an atomic to its animation). */
export type SpriteState = 'idle' | 'moving' | 'acting';

/** A vehicle's standing task, the original's vehicle-window numbering 0..6 as names (`Vehicle.task`). */
export type VehicleDrawTask =
  | 'none'
  | 'docks'
  | 'attacks'
  | 'waitsForHuman'
  | 'waitsForAnimal'
  | 'interrupted'
  | 'boardsShip';

/** The commander riding inside a vehicle, as its seat and `Settler` name him. */
export interface VehicleDriver {
  /** The rider's entity id, which seeds the figure's palette rolls. */
  readonly ref: number;
  readonly jobType: number;
  readonly tribe?: number;
  readonly female?: boolean;
}

/** The draw fields a fog ghost keeps from its last sighting, shared by every sprite kind. */
export interface StaticDrawFields {
  /** The type id a per-type binding picks its frame by: a tile's landscape typeId, or a building's
   *  `Building.buildingType` (the `[GfxHouse]` `LogicType`). Omitted for settler/resource. */
  typeId?: number;
  /** Remaining fraction of the currently built health pool, remembered under fog (0..1, exclusive of 1). */
  hpFrac?: number;
  /** For an under-construction building: build progress as a whole percent (0..99, floored
   *  `Building.built`), which picks the `[GfxHouse]` layers showing at this stage. */
  builtPct?: number;
  /** A resource node's `Resource.goodType`, or the good a stockpile pile mainly holds. Omitted for a
   *  delivery flag and an empty pile, which draw the flag rather than a heap. */
  goodType?: number;
  /** For a stockpile pile: units of {@link goodType} held, which grows the drawn heap with its
   *  contents. */
  fill?: number;
  /** A mined deposit's or crop's visual fill level in `[1, levels]`, stepping down from `levels` as it
   *  empties. Omitted for a plain node, which draws its full-state frame. */
  level?: number;
  /** The {@link level} ladder's denominator (`MineDeposit.levels` or a crop's `stages`). Must travel
   *  with {@link level}, which would otherwise redraw at a different frame. */
  levels?: number;
  /** A resource node's `Resource.gfxIndex`: the exact `[GfxLandscape]` record it was spawned from, so a
   *  map keeps its species variety. Omitted for an admin/scene-spawned node. */
  gfxIndex?: number;
  /** A settler's `Settler.tribe`, a building's `Building.tribe` or a vehicle's `Vehicle.tribe`: the key
   *  of the per-tribe look tables, and for a wildlife entity (a settler of an animal tribe with a null
   *  `jobType`) the species key. */
  tribe?: number;
  /** Edge posts this palisade draws: those standing nearer it than the edge's other end, and a gate
   *  collar's. Each offset is feet-local draw px; the optional percentage selects the interpolated
   *  durability/construction state of the endpoints. */
  palisadePosts?: readonly PalisadePostDraw[];
  /** An unfinished palisade site: its plan stake until a builder claims it, then the stake's stone ring
   *  with the ordinary delivery/work flag planted in it, and no heap for its wood, until the wall stands. */
  palisadeSite?: 'unclaimed' | 'claimed';
  /** A road site: its pegged plot until a builder claims it, then the plot with the builder's flag planted
   *  in it, until the road is paved. */
  roadSite?: 'unclaimed' | 'claimed';
  /**
   * For a settler or vehicle: facing direction index (0..7) a directional binding indexes by. The
   * `CR_Hum_Body` blocks are not a uniform rotation (source basis "Settler facing"): `0 SW, 1 W, 2 NW,
   * 3 NE, 4 E, 5 SE, 6 S, 7 N`. Omitted for a settler that is not moving; a vehicle always carries its
   * `Vehicle.facing`, remapped from its eight walk headings.
   */
  facing?: number;
  /** For a settler, signpost or vehicle: the team-colour slot - the player recipe a human's palettes
   *  compose from, the ship LUT row, and the signpost's baked per-colour atlas. Defaults to the owning
   *  `Owner.player` slot, or carries the mapped colour when the scene was built with a
   *  `playerColourOf`. */
  player?: number;
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
  /** Composed sort key: the anchor's depth plus the per-kind paint bias. */
  readonly depth: number;
  /** For a fish swarm: how many independently moving fish the renderer emits, capped at the sim's
   *  swarm maximum. */
  readonly swarmCount?: number;
  /** For a stockpile: a designated delivery flag rather than a loose pile - a marker holding no
   *  goods. */
  readonly isFlag?: boolean;
  /** For a `signpost` board item: an index into the binding's 20°-step board frames around the post
   *  top. Omitted for the post itself. */
  readonly boardIndex?: number;
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /** For an `acting` sprite: whole ticks in its current atomic so far (derived from `AtomicClock`). A
   *  binding advances one frame per `ticksPerFrame` of these, so every action animates at the same
   *  cadence. */
  readonly elapsed?: number;
  /** For an `acting` sprite: its current atomic's length in ticks (`CurrentAtomic.duration`), which a
   *  clip that spans its atomic is stretched over. */
  readonly atomicDuration?: number;
  /** For a settler: hauling a good (`Carrying` present). Orthogonal to {@link state}, since a settler
   *  can carry while `moving` or `acting`; the loaded gait replaces the empty-handed one (the
   *  original's `..._walk_wood` instead of `..._walk`). For a vehicle: its hold is not empty. */
  readonly carrying?: boolean;
  /** For a {@link carrying} settler: the hauled `Carrying.goodType`, which draws the matching load. For
   *  a carrying vehicle: the good with the most units aboard. */
  readonly carryGood?: number;
  /** For a vehicle: the job and tribe of the commander riding inside it, which a cart draws as one figure
   *  with its driver. */
  readonly driver?: VehicleDriver;
  /** For a vehicle: its standing task, which picks the attack clip while it `attacks`. */
  readonly task?: VehicleDrawTask;
  /** For a ship: lying at a shore (`Vehicle.moored`), which draws the furled-sail hull. */
  readonly moored?: boolean;
  /** For an attacking vehicle: the tick its current clip began (`Vehicle.attack.clipStart`), so the
   *  drawn shot and its smoke run from the clip's own start rather than a global cadence. */
  readonly attackClipStart?: number;
  /** For a settler: combat-engaged (`Engagement` present). Orthogonal to {@link state}: the readied
   *  `..._agressive` gait replaces the relaxed economy one, though a bound attack swing still wins
   *  mid-swing. */
  readonly engaged?: boolean;
  /** A moving animal using its authored fast gait. */
  readonly running?: boolean;
  /** For a settler: its `Settler.jobType`, the body/head look key (the original's `[jobbasegraphics]`
   *  job → body/head join). Omitted when the settler has no job. */
  readonly jobType?: number;
  /**
   * For a settler: the `typeId` of the good in its `Equipment.weapon` slot, so the drawn weapon follows
   * the slot rather than the job. `null` when the settler carries an `Equipment` whose weapon slot is
   * empty, which draws a warrior job's bare-hands body. Omitted when the settler has no `Equipment` at
   * all, which leaves the {@link jobType} look standing.
   */
  readonly weaponGood?: number | null;
  /** {@link weaponGood}'s twin for the `Equipment.armor` slot, the armor-recolor key, same tri-state. */
  readonly armorGood?: number | null;
  /** For a settler: born young (`Age` present), the only thing separating the age-class `jobType` ids
   *  1..4 from a synthetic fixture's colliding adult job ids. */
  readonly young?: boolean;
  /** For a settler: its mission behaviour mask asks for the hero glow, whatever its job. */
  readonly glow?: boolean;
  /** For a settler: `Female` present, which picks the women's player palette recipe. */
  readonly female?: boolean;
  /** For a building upgrading into its next level: upgrade progress as a whole percent (0..99, floored
   *  `Building.built`). Distinct from {@link builtPct}, since an upgrading building keeps its finished
   *  old-tier body and the next tier's overlay (the `[GfxHouse]` `upgrade === 1` rows) reveals over it
   *  at this progress. */
  readonly upgradePct?: number;
  /** For a finished building: mid production cycle (`Production` present), which switches on an animated
   *  state overlay such as the mill's rotor. Approximation of the original's overlay state 1:
   *  `Production` persists through a brief worker-away pause, whose exact behaviour is unobserved. */
  readonly working?: boolean;
  /** For a projectile: flight heading in screen space (radians, 0 = screen-east, clockwise), tilted
   *  along the drawn arc's tangent when the launch origin is readable. */
  readonly rotation?: number;
  /** For a projectile: the `munitionType` its sprite binds by. */
  readonly munition?: number;
  /** A siege shot, which the shot layer draws on its own flight clock rather than the pool. */
  readonly siege?: true;
  /** A remembered static drawn from the viewer's fog memory rather than a live entity. It draws dimmed
   *  and stamps no hit bounds, so clicking scenery intel cannot select a fogged, possibly dead,
   *  entity. */
  readonly ghost?: boolean;
  /** The draw-height lift at this item's feet in world px (≥ 0, terrain elevation plus a projectile's
   *  arc height), subtracted from the drawn `y`. The anchor and {@link depth} stay pre-lift, so a
   *  lifted sprite still occludes by feet row. */
  readonly lift?: number;
  /** This item only survived the cull as the details-panel portrait's subject: it stays reconciled and
   *  paletted for the portrait's own render but is hidden on the main map, so an indoor settler cannot
   *  pop into view at its workplace door. */
  readonly portraitOnly?: boolean;
  /** Freeze this settler's animation clock to a fixed standing frame rather than the breathing idle
   *  loop. Set on every settler drawn while inside a building, and on a portrait subject aboard a
   *  vehicle. */
  readonly frozen?: boolean;
  /** This settler is drawn inside its workplace by an in-house craft program: its anchor is the house's,
   *  offset by the program, and its gait runs on the free tick rather than on ground covered. */
  readonly inHouse?: boolean;
  /** For an {@link inHouse} settler mid-motion: the sub-clip it performs and how far through it. Absent
   *  while the program has it crossing the room. */
  readonly craftClip?: InHouseClip;
  /** For a `craftfx` item: the `[GfxLandscape]` record (`EditName`) the in-house program stages here, a
   *  looping effect such as the fire under a cauldron. */
  readonly fxName?: string;
}

export interface PalisadePostDraw {
  readonly dx: number;
  readonly dy: number;
  readonly gfxIndex: number;
  /** Advance this many places through the binding's wall-variant order. */
  readonly variantStep: number;
  /** Source wall-state percentage: build progress capped by remaining durability. */
  readonly builtPct?: number;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled: fields are
 *  conditionally assigned rather than conditionally spread, since a spread per optional field
 *  allocates a throwaway object at thousands of sprites × 60 fps. */
export type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };

export interface SpriteDrawItem extends DrawItem {
  readonly kind: SpriteKind;
}

export type MutableSpriteDrawItem = { -readonly [K in keyof SpriteDrawItem]: SpriteDrawItem[K] };

/** Every {@link SpriteDrawItem} field, each one present. */
type DrawItemLayout = { -readonly [K in keyof SpriteDrawItem]-?: SpriteDrawItem[K] | undefined };

/**
 * A fresh item with every draw item field present in one fixed order, the unset ones `undefined`. Every
 * scene item then shares one hidden class, so the per-frame readers load its fields monomorphically
 * rather than through megamorphic loads, which box each numeric field read.
 */
export function newDrawItem(
  kind: SpriteKind,
  ref: number,
  x: number,
  y: number,
  depth: number,
  state: SpriteState | undefined,
): MutableSpriteDrawItem {
  const item: DrawItemLayout = {
    kind,
    ref,
    x,
    y,
    depth,
    state,
    lift: undefined,
    typeId: undefined,
    builtPct: undefined,
    goodType: undefined,
    fill: undefined,
    level: undefined,
    levels: undefined,
    gfxIndex: undefined,
    tribe: undefined,
    palisadePosts: undefined,
    palisadeSite: undefined,
    roadSite: undefined,
    facing: undefined,
    player: undefined,
    swarmCount: undefined,
    isFlag: undefined,
    boardIndex: undefined,
    atomicId: undefined,
    elapsed: undefined,
    atomicDuration: undefined,
    carrying: undefined,
    carryGood: undefined,
    driver: undefined,
    task: undefined,
    moored: undefined,
    attackClipStart: undefined,
    engaged: undefined,
    running: undefined,
    jobType: undefined,
    weaponGood: undefined,
    armorGood: undefined,
    young: undefined,
    glow: undefined,
    female: undefined,
    upgradePct: undefined,
    working: undefined,
    hpFrac: undefined,
    rotation: undefined,
    munition: undefined,
    siege: undefined,
    ghost: undefined,
    portraitOnly: undefined,
    frozen: undefined,
    inHouse: undefined,
    craftClip: undefined,
    fxName: undefined,
  };
  return item as MutableSpriteDrawItem;
}

/** Unset `key` on a {@link newDrawItem} item; deleting it would give the item a hidden class of its own. */
export function unsetDrawField(item: MutableSpriteDrawItem, key: keyof SpriteDrawItem): void {
  (item as DrawItemLayout)[key] = undefined;
}
