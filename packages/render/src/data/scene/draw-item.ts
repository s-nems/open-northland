/**
 * The scene layer's shared vocabulary — the {@link DrawItem} shape the pure scene builders emit and the
 * GPU layer consumes. Types + one paint-order table only; the builders live in
 * {@link import('./sprite-scene.js')} / {@link import('./terrain-scene.js')} (the latter also owns the
 * terrain-grid shapes), the per-component snapshot reads in {@link import('./snapshot-readers/index.js')}.
 */

/** Kinds of thing the scene draws, in their natural layer grouping. */
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

/**
 * A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 * `tribetypes` `setatomic` maps an atomic → its animation). Derived purely from the snapshot's
 * components: `CurrentAtomic` ⇒ `acting` (the atomic's numeric id rides along as
 * {@link DrawItem.atomicId} so a binding can pick the specific action's frame), else a live `PathFollow`
 * ⇒ `moving`, else `idle`. Buildings and resources are always `idle` (they don't animate per-state in
 * this slice).
 */
export type SpriteState = 'idle' | 'moving' | 'acting';

/**
 * Same-feet-anchor paint priority per drawable kind — a higher value draws later (in front) when two
 * sprites resolve to (nearly) the same depth. A worker stands on the resource cell it harvests and a
 * delivery flag sits on the ground drops piling up around it, so without a tiebreak the taller node/drop
 * paints over the unit/flag by mere attach order. Applied as a sub-cell epsilon (`PAINT_ORDER_EPS` in
 * the scene builder; `SCREEN_PAINT_EPS` in the live painter) — orders of magnitude below one row's depth
 * separation — so it only breaks ties at a shared anchor and never reorders sprites a genuine row apart.
 * Read it through {@link paintOrderBias} (never combined with {@link FLAG_PAINT_STEP} by hand). `tile`
 * is 0 (tiles carry their own sub-zero depth band).
 */
export const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  resource: 0,
  berrybush: 0, // a bush sits behind the settler foraging it, like a resource node
  stump: 0,
  building: 1,
  grounddrop: 1,
  signpost: 1, // the post occludes like a small building; its boards ride the flag half-step above it
  stockpile: 2,
  settler: 3,
  projectile: 4, // an arrow in flight crosses over the fighters it flies between
};

/**
 * Extra fractional paint-order step a delivery flag ({@link DrawItem.isFlag}) gets above a plain
 * `stockpile` heap on the same tile. A flag and the goods heaps it collects are both `stockpile` kind
 * (same {@link SPRITE_PAINT_ORDER}), so the kind bias alone ties them — and since the flag is created
 * first (lowest id) the id tiebreak would bury it under the later heap. Half a paint step lifts the flag
 * just past a co-located heap; `2 + 0.5` sits below `settler`'s `3`, so a worker on the tile still draws
 * in front.
 */
export const FLAG_PAINT_STEP = 0.5;

/**
 * The same-feet-anchor paint bias of a draw item — the kind's {@link SPRITE_PAINT_ORDER} plus the extra
 * {@link FLAG_PAINT_STEP} for a delivery flag — as a unitless order value. Both the headless oracle
 * ({@link import('./sprite-scene.js')}) and the live painter
 * ({@link import('../../gpu/sprite-pool/sprite-pool.js')}) multiply it by their own sub-cell epsilon
 * (`PAINT_ORDER_EPS` / `SCREEN_PAINT_EPS`), so the tiebreak can't drift between the two depth keys (a
 * drift would sort occlusion differently on screen than in the oracle).
 */
export function paintOrderBias(kind: DrawKind, isFlag = false): number {
  return SPRITE_PAINT_ORDER[kind] + (isFlag ? FLAG_PAINT_STEP : 0);
}

/**
 * One item to draw, already projected to isometric screen space (before the camera transform). The
 * GPU layer draws these in array order; `depth` is the sort key it was ordered by (kept for debug /
 * stable-sort proofs). Floats are deliberate (render-only).
 */
export interface DrawItem {
  readonly kind: DrawKind;
  /** Source entity id, or the cell id for a terrain tile (so a click can map a pixel back). */
  readonly ref: number;
  /** Isometric screen position of the item's anchor (tile centre for tiles; feet for sprites). */
  readonly x: number;
  readonly y: number;
  /** The world-space sort key the item was ordered by (see {@link import('./terrain-scene.js').buildScene}). */
  readonly depth: number;
  /**
   * The type id a per-type binding picks its frame by: a terrain tile's landscape typeId, or a
   * building's `Building.buildingType` (the `[GfxHouse]` `LogicType` →
   * {@link import('../sprites/index.js').BuildingTypeBinding}). Omitted for settler/resource.
   */
  readonly typeId?: number;
  /**
   * A resource node's `Resource.goodType`, or the good a stockpile pile mainly holds — the key a
   * per-good {@link import('../sprites/index.js').ResourceTypeBinding} /
   * {@link import('../sprites/index.js').StockpileBinding} draws by. Omitted for a delivery flag
   * ({@link isFlag}) and an empty pile (both draw the flag, not a heap).
   */
  readonly goodType?: number;
  /**
   * For a stockpile pile: units of {@link goodType} held — a
   * {@link import('../sprites/index.js').StockpileBinding} maps it to a per-fill heap frame so the pile
   * grows with its contents. Omitted for an empty pile (a flag) and non-stockpile kinds.
   */
  readonly fill?: number;
  /**
   * For a stockpile: whether it is a designated delivery flag (a
   * {@link import('@open-northland/sim').DeliveryFlag}) rather than a loose pile — a marker holding no
   * goods that draws the flag graphic, painted a hair above any co-located heap ({@link FLAG_PAINT_STEP}).
   * Omitted (falsy) for a loose pile and non-stockpiles.
   */
  readonly isFlag?: boolean;
  /**
   * For a `signpost` item: which direction-board frame to draw — an index into the binding's angular
   * board list ({@link import('../sprites/index.js').SignpostBinding.boards}, 20°-step frames around
   * the post top). Omitted for the post itself. Board items are synthesized per connected in-range
   * neighbour by the scene collector, anchored on the same feet position (the frames' offsets carry
   * the nail-point pivot).
   */
  readonly boardIndex?: number;
  /**
   * For a mined resource node ({@link import('@open-northland/sim').MineDeposit}) or a crop: its visual
   * fill level in `[1, levels]`, stepping down from `levels` (full) as it empties — a
   * {@link import('../sprites/index.js').ResourceTypeBinding} indexes the fill-state frames by it (the node
   * twin of a pile's {@link fill}). Omitted for a plain node, which draws its full-state frame.
   */
  readonly level?: number;
  /**
   * The {@link level} ladder's denominator (`MineDeposit.levels` or a crop's `stages`). The resolver
   * rescales the ladder onto the bound record's own authored frame count when they differ (the sim
   * buckets every deposit into one catalog count, but each `[GfxLandscape]` variant authors its own —
   * stone rocks 4, ore mines 5), so a full deposit always draws its fullest frame. Omitted with {@link level}.
   */
  readonly levels?: number;
  /**
   * For a resource node: the exact `[GfxLandscape]` record it was spawned from (`Resource.gfxIndex` —
   * a map's own species variant, "pine 02", "stones 05 grey"). A
   * {@link import('../sprites/index.js').ResourceTypeBinding.byGfxIndex} entry wins over the per-good
   * representative, so a map keeps its variety. Omitted for an admin/scene-spawned node.
   */
  readonly gfxIndex?: number;
  /** For a sprite: its coarse logical state, so a per-state binding can pick the right frame. */
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /**
   * For an `acting` sprite: whole ticks in its current atomic so far (`CurrentAtomic.elapsed`), the
   * action's animation clock. A directional binding advances one frame per `ticksPerFrame` of these, a
   * fixed cadence, so every action animates at the same speed. Omitted when idle.
   */
  readonly elapsed?: number;
  /**
   * For a settler: facing direction index (0..7) a directional binding indexes by. The `CR_Hum_Body`
   * blocks are not a uniform rotation (source basis "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE, 4 E,
   * 5 SE, 6 S, 7 N`. Omitted when not moving (binding falls back to
   * {@link import('../sprites/index.js').DEFAULT_FACING}).
   */
  readonly facing?: number;
  /**
   * For a settler: whether it is hauling a good (`Carrying` present). Orthogonal to {@link state} (a
   * settler can carry while `moving` or `acting`); a binding swaps the empty-handed gait for the loaded
   * one (the original's `..._walk_wood` instead of `..._walk`). Omitted when carrying nothing.
   */
  readonly carrying?: boolean;
  /**
   * For a {@link carrying} settler: the hauled `Carrying.goodType`, so a per-good loaded-gait binding
   * ({@link import('../sprites/index.js').CarryingBinding.byGood}) draws the matching load. Omitted when
   * not carrying.
   */
  readonly carryGood?: number;
  /**
   * For a settler: whether it is combat-engaged (`Engagement` present). Orthogonal to {@link state}: a
   * binding swaps the relaxed economy gait for the readied `..._agressive` one
   * ({@link import('../sprites/index.js').SettlerStateBinding.engaged}), though a bound attack swing still
   * wins mid-swing. Omitted when not fighting.
   */
  readonly engaged?: boolean;
  /**
   * For a settler: its `Settler.jobType`, the key a per-character binding
   * ({@link import('../sprites/index.js').ByJobTable}) picks the body/head look by (the original's
   * `[jobbasegraphics]` job → body/head join). Omitted when the settler has no job (falls back to the
   * default look).
   */
  readonly jobType?: number;
  /**
   * For a settler: the `typeId` of the good in its `Equipment.weapon` slot. A per-character binding
   * maps it to a warrior look ({@link import('../sprites/index.js').ByJobTable.byWeaponGood}) so the drawn
   * weapon follows the slot rather than the job. Omitted when unarmed (falls back to the {@link jobType} look).
   */
  readonly weaponGood?: number;
  /**
   * For a settler: the owning `Owner.player` slot, so the `PalettedSprite` reads its clothing-band
   * indices through that player's row of the `256×N` colour LUT. Omitted for an unowned settler
   * (wildlife / neutral fixture), which draws the base palette (LUT row 0).
   */
  readonly player?: number;
  /**
   * For a settler: whether it is born-young (baby/child — `Age` present). Disambiguates the age-class
   * `jobType` ids (1..4) from a synthetic fixture's colliding adult job ids (AGENTS.md [dc3ef54]): only a
   * young settler keys the child/baby body table. Omitted for adults.
   */
  readonly young?: boolean;
  /**
   * For an under-construction building: build progress as a whole percent (0..99, floored
   * `Building.built`). The construction-stage binding
   * ({@link import('../sprites/index.js').BuildingTypeBinding.constructionByType}) picks which `[GfxHouse]`
   * layers show at this progress (grey foundation at 0, rising stages after). Omitted for a finished
   * building (`built >= ONE`) and non-building kinds.
   */
  readonly builtPct?: number;
  /**
   * For a finished building: whether it is mid production cycle (`Production` present) — the key an
   * animated state overlay switches on ({@link import('../sprites/index.js').BuildingTypeBinding.overlayByType},
   * the mill's spinning rotor). A named approximation of the original's overlay state 1: `Production`
   * persists through a brief worker-away pause (the rotor keeps spinning), whose exact behaviour is
   * unobserved. Omitted for an idle workplace and non-building kinds.
   */
  readonly working?: boolean;
  /**
   * For a projectile: flight heading in screen space (radians, 0 = screen-east, clockwise) — the pooled
   * arrow (authored pointing screen-east) rotates to it so the shaft points along the flight, tilted
   * along the drawn ballistic arc's tangent when the launch origin is readable. Omitted for other kinds.
   */
  readonly rotation?: number;
  /**
   * Whether this item is a fog ghost — a remembered static drawn from the viewer's
   * {@link import('../fog-ghosts.js').FogGhostStore} memory on explored ground, not a live entity. The pool
   * dims it ({@link import('../fog.js').FOG_GHOST_TINT}) and stamps no hit bounds (clicking scenery intel
   * must not select a fogged, possibly dead, entity). Omitted (falsy) for live-drawn items.
   */
  readonly ghost?: boolean;
  /**
   * The draw-height lift (world px, ≥ 0) at this item's feet — terrain elevation plus a projectile's
   * arc height — subtracted from the drawn `y`. The anchor {@link x}/{@link y} and {@link depth} stay
   * pre-lift, so a lifted sprite still occludes by feet row (draw at `y − lift`, sort by `y`). Omitted
   * (0) on a flat map with nothing in flight.
   */
  readonly lift?: number;
  /**
   * The composed terrain-shading multiplier at this item's feet (1 = neutral; `data/brightness.ts` +
   * hillshade), so an entity sits in the same light as the ground it stands on — an OpenNorthland
   * enhancement (the original leaves buildings/settlers unshaded; the corpus base sits near neutral so
   * the deviation is small on real maps). Omitted on an unshaded map, for fog ghosts (already dimmed),
   * for resource nodes (trees draw full-bright in the original — the measured canopy split in
   * `data/brightness.ts`; kept for the whole kind so the static→pool handover can't jump) and for
   * projectiles (airborne). Plain sprites apply it as a tint (clamps at ×1); paletted settlers
   * multiply in-shader (can brighten).
   */
  readonly shade?: number;
  /**
   * This item only survived the cull because it is the details-panel portrait's subject (off-screen,
   * fogged, or a settler inside a building — cases the map normally drops). The pool keeps it reconciled
   * and paletted so the portrait's second render can draw it, but hides it on the MAIN map (an off-screen
   * settler is off-canvas anyway; an indoor one must not pop into view at its workplace door). Omitted
   * (falsy) for a normally-drawn item.
   */
  readonly portraitOnly?: boolean;
  /**
   * Freeze this settler's animation clock to a fixed standing frame (the portrait subject while it is
   * inside a building): a motionless pose rather than the breathing idle loop. Omitted (falsy) for a
   * normally-animating item.
   */
  readonly frozen?: boolean;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled (the fields are
 *  conditionally assigned instead of conditionally spread — a spread per optional field allocates a
 *  throwaway object each, a real per-frame GC cost at thousands of sprites × 60 fps). */
export type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };
