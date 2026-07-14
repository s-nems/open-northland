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
 * `tile` is 0 (tiles carry their own sub-zero depth band).
 *
 * Read this table through {@link paintOrderBias} rather than combining it with {@link FLAG_PAINT_STEP}
 * by hand at a depth site, so the tiebreak stays identical across the oracle sort and the live painter.
 */
export const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  resource: 0,
  berrybush: 0, // a bush sits behind the settler foraging it, like a resource node
  stump: 0,
  building: 1,
  grounddrop: 1,
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
   * The drawable's type id, so a per-type binding picks the right frame: for a terrain tile its
   * landscape typeId (the GPU layer tints/textures by it); for a building its `Building.buildingType`
   * (the `[GfxHouse]` `LogicType` — a per-type {@link import('../sprites/index.js').BuildingTypeBinding} draws
   * each building's own house bob). Omitted for kinds that don't key off a type (settler/resource).
   */
  readonly typeId?: number;
  /**
   * For a resource node its `Resource.goodType`, and for a stockpile the good its ground pile mainly
   * holds — the key a per-good {@link import('../sprites/index.js').ResourceTypeBinding} /
   * {@link import('../sprites/index.js').StockpileBinding} draws each good's own object by. Omitted for a
   * delivery flag ({@link isFlag}, which holds no goods) and an empty pile — both drawn as the flag
   * sprite rather than a heap. Never set for tiles/buildings/settlers (they key off other fields).
   */
  readonly goodType?: number;
  /**
   * For a stockpile ground pile: how many units of its {@link goodType} it holds — the fill amount a
   * {@link import('../sprites/index.js').StockpileBinding} maps to a per-fill heap frame (a small heap at 1, a
   * full one at the pile's max state), so a pile visibly grows with its contents. Omitted for an empty
   * pile (a flag) and for every non-stockpile kind.
   */
  readonly fill?: number;
  /**
   * For a stockpile: whether it is a designated delivery flag (a
   * {@link import('@open-northland/sim').DeliveryFlag} collection point) rather than a loose ground pile. A flag is
   * a marker that holds no goods (no `goodType`/`fill`) — it draws the flag graphic and is painted a hair
   * above any co-located goods heap ({@link FLAG_PAINT_STEP}). Omitted (falsy) for a loose pile and every
   * non-stockpile.
   */
  readonly isFlag?: boolean;
  /**
   * For a mined resource node (a {@link import('@open-northland/sim').MineDeposit} deposit): its visual fill
   * level — a small integer in `[1, levels]`, `levels` when the deposit is full stepping down to `1` as it
   * nears empty. A per-good {@link import('../sprites/index.js').ResourceTypeBinding} indexes the mine record's
   * fill-state frames by it, so the drawn deposit shrinks in step with what has been mined (the node twin
   * of a pile's {@link fill}). Omitted for a plain node (a tree/mushroom/full showcase deposit), which
   * draws its full-state frame.
   */
  readonly level?: number;
  /**
   * For a mined resource node: how many levels its {@link level} ladder has (the sim's
   * `MineDeposit.levels`, or a crop's `stages`) — `level === levels` is full. The resolver rescales the
   * ladder onto the bound record's own frame count when the two differ (the sim buckets every deposit
   * into one catalog level count, but each `[GfxLandscape]` variant authors its own state count — stone
   * rocks carry 4, the ore mines 5), so a full deposit always draws its fullest authored frame. Omitted
   * with {@link level} for a plain node.
   */
  readonly levels?: number;
  /**
   * For a resource node: the exact `[GfxLandscape]` record it was spawned from (the snapshot's
   * `Resource.gfxIndex` render-variant tag) — a decoded map's own species variant ("pine 02",
   * "stones 05 grey"). A {@link import('../sprites/index.js').ResourceTypeBinding.byGfxIndex} entry wins
   * over the per-good representative, so a map keeps its full original variety. Omitted for an
   * admin/scene-spawned node, which draws the per-good node.
   */
  readonly gfxIndex?: number;
  /** For a sprite: its coarse logical state, so a per-state binding can pick the right frame. */
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /**
   * For an `acting` sprite: whole ticks executed in its current atomic so far — the sim's
   * `CurrentAtomic.elapsed`, the animation clock for an action. A directional binding advances its swing
   * one frame every `ticksPerFrame` of these ticks, a fixed cadence — so every action animates at the
   * same speed (a 15-tick chop and a 4-tick deposit step frames identically), and a swing plays its full
   * cycle because the action's duration is tuned to a whole number of cycles. Omitted when idle.
   */
  readonly elapsed?: number;
  /**
   * For a settler: its facing direction index (0..7) — the screen-space heading a directional
   * animation binding indexes by. The `CR_Hum_Body` bob layout is not a uniform rotation; its 8 blocks
   * face (read off the decoded frames, `source basis` "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE,
   * 4 E, 5 SE, 6 S, 7 N`. Derived from the live {@link import('./snapshot-readers/index.js').readFacing}
   * heading; omitted when the settler isn't moving (the binding then falls back to
   * {@link import('../sprites/index.js').DEFAULT_FACING}).
   */
  readonly facing?: number;
  /**
   * For a settler: whether it is currently hauling a good (the sim `Carrying` component is present).
   * Orthogonal to {@link state} — a settler can be carrying while `moving` (walking a load home) or
   * `acting` (depositing it). A binding reads it to swap the empty-handed gait for the loaded one (the
   * original's `..._walk_wood` bobseq instead of `..._walk`). Omitted when the settler carries nothing.
   */
  readonly carrying?: boolean;
  /**
   * For a {@link carrying} settler: the hauled `Carrying.goodType`, so a per-good loaded-gait binding
   * ({@link import('../sprites/index.js').CarryingBinding.byGood}) draws the matching load (the original's
   * `..._walk_<good>` bobseq per good). Omitted when not carrying.
   */
  readonly carryGood?: number;
  /**
   * For a settler: whether it is combat-engaged (the sim `Engagement` marker is present) — advancing
   * on or standing off against an enemy. Orthogonal to {@link state}: a binding reads it to swap the
   * relaxed economy walk/wait for the readied `..._agressive` gait ({@link
   * import('../sprites/index.js').SettlerStateBinding.engaged}). A bound attack swing still wins while
   * mid-swing. Omitted when the unit is not fighting.
   */
  readonly engaged?: boolean;
  /**
   * For a settler: its `Settler.jobType` — the key a per-character binding
   * ({@link import('../sprites/index.js').ByJobTable}) picks the body/head look by (the original's
   * `[jobbasegraphics]` job → body/head join: a soldier draws the armoured `cr_hum_body_05`, a woman
   * `cr_hum_body_10`, …). Omitted when the settler has no job (`jobType` null) — the binding then falls
   * back to its default look.
   */
  readonly jobType?: number;
  /**
   * For a settler: the `typeId` of the good in its `Equipment.weapon` slot, when it carries one. The
   * per-character binding maps it to a warrior look ({@link import('../sprites/index.js').ByJobTable.byWeaponGood})
   * so the drawn weapon follows the equipment slot rather than the job — equip a bow and the warrior
   * draws the bow body. Omitted when the settler has no weapon equipped (falls back to the `jobType` look).
   */
  readonly weaponGood?: number;
  /**
   * For a settler: the owning player slot (the sim `Owner.player`), so the renderer can paint the unit in
   * that player's team colour — the render `PalettedSprite` reads its clothing-band indices through the
   * player's row of the `256×N` colour LUT. Omitted for an unowned settler (wildlife / a neutral fixture),
   * which draws the base palette (LUT row 0).
   */
  readonly player?: number;
  /**
   * For a settler: whether it is a born-young (baby/child) settler — the sim `Age` component is present.
   * Disambiguates the age-class `jobType` ids (1..4) from a synthetic fixture's colliding adult job ids
   * (AGENTS.md [dc3ef54]): only a young settler keys the child/baby body table. Omitted for adults.
   */
  readonly young?: boolean;
  /**
   * For an under-construction building: its build progress as a whole percent (0..99 — the sim's
   * `Building.built` fixed-point fraction, floored). The construction-stage binding
   * ({@link import('../sprites/index.js').BuildingTypeBinding.constructionByType}) picks which `[GfxHouse]`
   * construction layers are visible at this progress (the grey foundation at 0, rising stages after).
   * Omitted for a finished building (`built >= ONE`) — the normal per-type body draw then applies —
   * and for non-building kinds.
   */
  readonly builtPct?: number;
  /**
   * For a finished building: whether it is mid production cycle (the sim `Production` component
   * is present) — the key an animated state overlay switches on (the mill's rotor spins while the
   * mill produces, {@link import('../sprites/index.js').BuildingTypeBinding.overlayByType}). A named
   * approximation of the original's overlay state 1: `Production` persists through a brief
   * worker-away pause (the cycle holds, the drawn rotor keeps spinning); the original's exact
   * pause behaviour is unobserved. Omitted for an idle workplace and every non-building kind.
   */
  readonly working?: boolean;
  /**
   * For a projectile: its flight heading in screen space (radians, 0 = screen-east, clockwise) —
   * the pooled arrow graphic (authored pointing screen-east) rotates to it so the shaft points along
   * the flight. Derived from the projectile's position toward its target's live position (the sim's
   * homing step re-aims every tick, so the heading tracks the flight), tilted along the drawn ballistic
   * arc's tangent when the shot's launch origin is readable. Omitted for every other kind.
   */
  readonly rotation?: number;
  /**
   * Whether this item is a fog ghost — a remembered static (building/resource/stump) drawn from the
   * viewer's {@link import('../fog-ghosts.js').FogGhostStore} memory on explored ground, not from a live
   * snapshot entity. The pool dims it to the explored-grey grading ({@link import('../fog.js').FOG_GHOST_TINT})
   * and stamps no hit bounds (a ghost is scenery intel — clicking it must not select a fogged, possibly
   * dead, entity). Omitted (falsy) for every live-drawn item.
   */
  readonly ghost?: boolean;
  /**
   * The draw-height lift (world px, ≥ 0) at this item's feet — terrain elevation, plus a projectile's
   * ballistic-arc height while mid-lob — subtracted from the drawn `y` so the sprite sits on the lifted
   * ground. The anchor {@link x}/{@link y} and its {@link depth} stay pre-lift: the painter key must
   * remain the feet row, so a lifted-up sprite on a nearer row still occludes one behind it (draw at
   * `y − lift`, sort by `y`). Omitted (treated as 0) on a flat map with nothing in flight.
   */
  readonly lift?: number;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled (the fields are
 *  conditionally assigned instead of conditionally spread — a spread per optional field allocates a
 *  throwaway object each, a real per-frame GC cost at thousands of sprites × 60 fps). */
export type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };
