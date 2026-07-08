/**
 * The scene layer's shared vocabulary — the draw-item shape the pure scene builders emit and the GPU
 * layer consumes, plus the terrain-grid shapes a decoded map projects onto. Types + one paint-order
 * table only; the builders live in {@link import('./sprite-scene.js')} / {@link import('./terrain-scene.js')},
 * the per-component snapshot reads in {@link import('./snapshot-readers.js')}.
 */

/** Kinds of thing the scene draws, in their natural layer grouping. */
export type DrawKind = 'tile' | 'building' | 'settler' | 'resource' | 'stockpile' | 'stump' | 'grounddrop';

/**
 * A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 * `tribetypes` `setatomic` maps an atomic → its animation; a settler walking shows the walk bob, one
 * mid-swing the chop bob). Derived purely from the snapshot's components — `CurrentAtomic` ⇒ `acting`
 * (and the atomic's numeric id rides along as {@link DrawItem.atomicId} so a binding can pick the
 * *specific* action's frame), else a live `PathFollow` ⇒ `moving`, else `idle`. Buildings/resources
 * are always `idle` (they don't animate per-state in this slice). This is the render-side reading of
 * sim state the plan calls "animation playback driven by each entity's logical state"; it never
 * re-enters the sim.
 */
export type SpriteState = 'idle' | 'moving' | 'acting';

/**
 * Same-feet-anchor paint priority per drawable kind — a higher value draws LATER (in front) when two
 * sprites resolve to (nearly) the same depth. A worker STANDS ON the resource cell it harvests and a
 * delivery flag SITS ON the ground drops piling up around it, so without a tiebreak the taller node/drop
 * paints over the unit/flag by mere attach order. The rule the eye expects: the **settler** is the focus
 * and sits in front of the terrain node/stump it works, and the **flag/pile** (`stockpile`) sits in front
 * of the loose `grounddrop` ore/logs. Applied as a sub-cell epsilon (`PAINT_ORDER_EPS` in the scene
 * builder; `SCREEN_PAINT_EPS` in the live painter) — orders of magnitude below one row's depth
 * separation — so it ONLY breaks ties at a shared anchor and never reorders sprites that are a genuine
 * row apart. `tile` is 0 (tiles carry their own sub-zero depth band).
 */
export const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  resource: 0,
  stump: 0,
  building: 1,
  grounddrop: 1,
  stockpile: 2,
  settler: 3,
};

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
   * The drawable's type id, so a per-type binding picks the right frame: for a terrain **tile** its
   * landscape typeId (the GPU layer tints/textures by it); for a **building** its `Building.buildingType`
   * (the `[GfxHouse]` `LogicType` — a per-type {@link import('../sprites/index.js').BuildingTypeBinding} draws
   * each building's own house bob). Omitted for kinds that don't key off a type (settler/resource).
   */
  readonly typeId?: number;
  /**
   * For a **resource** node its `Resource.goodType`, and for a **stockpile** the good its ground pile
   * mainly holds — the key a per-good {@link import('../sprites/index.js').ResourceTypeBinding} /
   * {@link import('../sprites/index.js').StockpileBinding} draws each good's own object by (a tree for wood, a
   * rock for stone, a wood pile vs a stone pile). OMITTED for a stockpile that holds nothing — an empty
   * bare `Stockpile` is a bare **delivery flag** (a designated collection point), drawn as the flag
   * sprite rather than a pile. Never set for tiles/buildings/settlers (they key off other fields).
   */
  readonly goodType?: number;
  /**
   * For a **stockpile** ground pile: how many units of its {@link goodType} it holds — the fill amount a
   * {@link import('../sprites/index.js').StockpileBinding} maps to a per-fill heap frame (a small heap at 1, a
   * full one at the pile's max state), so a pile visibly grows with its contents. OMITTED for an empty
   * pile (a flag) and for every non-stockpile kind.
   */
  readonly fill?: number;
  /**
   * For a **mined resource node** (a {@link import('@vinland/sim').MineDeposit} deposit): its visual fill
   * LEVEL — a small integer in `[1, levels]`, `levels` when the deposit is full stepping down to `1` as it
   * nears empty. A per-good {@link import('../sprites/index.js').ResourceTypeBinding} indexes the mine record's
   * fill-state frames by it, so the drawn deposit visibly SHRINKS in step with what has been mined (the
   * node twin of a pile's {@link fill}). OMITTED for a plain node (a tree/mushroom/full showcase deposit),
   * which draws its full-state frame — so an unmined node is unaffected.
   */
  readonly level?: number;
  /** For a sprite: its coarse logical state, so a per-state binding can pick the right frame. */
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /**
   * For an `acting` sprite: whole ticks executed in its current atomic so far — the sim's
   * `CurrentAtomic.elapsed`. The animation clock for an action: a directional binding advances its
   * swing one frame every `ticksPerFrame` of these ticks, a FIXED cadence — so every action animates at
   * the same speed (a 15-tick chop and a 4-tick deposit step frames identically), and a swing plays its
   * full cycle because the action's duration is tuned to a whole number of cycles. Omitted when idle.
   */
  readonly elapsed?: number;
  /**
   * For a settler: its facing direction index (0..7) — the screen-space heading a directional
   * animation binding indexes by. The `CR_Hum_Body` bob layout is NOT a uniform rotation; its 8 blocks
   * face (read off the decoded frames, `source basis` "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE,
   * 4 E, 5 SE, 6 S, 7 N`. Derived from the live {@link import('./snapshot-readers.js').readFacing}
   * heading; omitted when the settler isn't moving (the binding then falls back to
   * {@link import('../sprites/index.js').DEFAULT_FACING}).
   */
  readonly facing?: number;
  /**
   * For a settler: whether it is currently hauling a good (the sim `Carrying` component is present).
   * ORTHOGONAL to {@link state} — a settler can be carrying while `moving` (walking a load home) or
   * `acting` (depositing it). A binding reads it to swap the empty-handed gait for the loaded one (the
   * original's `..._walk_wood` bobseq instead of `..._walk`). Omitted when the settler carries nothing.
   */
  readonly carrying?: boolean;
  /**
   * For a {@link carrying} settler: the hauled `Carrying.goodType`, so a per-good loaded-gait binding
   * ({@link import('../sprites/index.js').CarryingBinding.byGood}) draws the RIGHT load (a log for wood, a slab
   * for stone — the original's `..._walk_<good>` bobseq per good). Omitted when not carrying.
   */
  readonly carryGood?: number;
  /**
   * For a settler: its `Settler.jobType` — the key a per-character binding
   * ({@link import('../sprites/index.js').ByJobTable}) picks the body/head look by (the original's
   * `[jobbasegraphics]` job → body/head join: a soldier draws the armoured `cr_hum_body_05`, a woman
   * `cr_hum_body_10`, …). Omitted when the settler has no job (`jobType` null) — the binding then falls
   * back to its default look.
   */
  readonly jobType?: number;
  /**
   * For a settler: the owning player slot (the sim `Owner.player`), so the renderer can paint the unit in
   * that player's TEAM COLOUR — the render `PalettedSprite` reads its clothing-band indices through the
   * player's row of the `256×N` colour LUT. Omitted for an UNOWNED settler (wildlife / a neutral fixture),
   * which draws the base palette (LUT row 0). This is the render half of the sim's owner-hostility axis.
   */
  readonly player?: number;
  /**
   * For a settler: whether it is a born-young (baby/child) settler — the sim `Age` component is present.
   * Disambiguates the age-class `jobType` ids (1..4) from a synthetic fixture's colliding adult job ids
   * (AGENTS.md [dc3ef54]): only a young settler keys the child/baby body table. Omitted for adults.
   */
  readonly young?: boolean;
  /**
   * For an UNDER-CONSTRUCTION building: its build progress as a whole percent (0..99 — the sim's
   * `Building.built` fixed-point fraction, floored). The construction-stage binding
   * ({@link import('../sprites/index.js').BuildingTypeBinding.constructionByType}) picks which `[GfxHouse]`
   * construction layers are visible at this progress (the grey foundation at 0, rising stages after).
   * OMITTED for a finished building (`built >= ONE`) — the normal per-type body draw then applies —
   * and for non-building kinds.
   */
  readonly builtPct?: number;
  /**
   * The terrain-elevation lift (world px, ≥ 0) at this item's feet — subtracted from the DRAWN `y` so
   * the sprite sits on the lifted ground (a settler on a hill rides up with it). ORTHOGONAL to {@link
   * x}/{@link y}: the anchor and its {@link depth} stay PRE-LIFT (the painter key must remain the feet
   * row, so a lifted-up sprite on a nearer row still occludes one behind it — the renderer draws at
   * `y − lift` but sorts by `y`). Omitted (treated as 0) on a flat map / synthetic content.
   */
  readonly lift?: number;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled (the fields are
 *  conditionally ASSIGNED instead of conditionally spread — a spread per optional field allocates a
 *  throwaway object each, a real per-frame GC cost at thousands of sprites × 60 fps). */
export type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };

/**
 * A decoded map's 1:1 per-triangle ground lanes (the `ground` layer of `content/maps/<id>.json`):
 * pattern `EditName`s + each cell's two triangle picks as indices into them. Render-only data — the
 * renderer joins a name through {@link import('../../gpu/pixi-app.js').TerrainTextureSet.groundFor}.
 */
export interface SceneGround {
  readonly patterns: readonly string[];
  /** Row-major per-cell index into {@link patterns} for triangle A (left half of the diamond). */
  readonly a: readonly number[];
  /** Row-major per-cell index into {@link patterns} for triangle B (right half of the diamond). */
  readonly b: readonly number[];
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
  /** The 1:1 per-triangle ground patterns, when the map carries them (a decoded original map). */
  readonly ground?: SceneGround;
  /**
   * The decoded map's per-cell `lmhe` terrain height (row-major, length `width*height`, 0..~250), when
   * present. The renderer builds an {@link import('../elevation.js').ElevationField} from it to lift the
   * ground mesh + every projected item; absent → flat (no lift). Render-only data — the sim never reads it.
   */
  readonly elevation?: readonly number[];
  /**
   * The decoded map's per-cell `embr` baked shading (row-major, length `width*height`, u8 with 127 =
   * neutral), when present. The GROUND mesh consumes it per FRAGMENT (luminance × value/127 sampled
   * from an R8 lane texture — slope light/shadow plus the fade-to-black map border); absent →
   * unshaded. Landscape objects shade separately at their anchor cell via an app-built
   * {@link import('../brightness.js').BrightnessField} (trees exempt — the measured split; see
   * `data/brightness.ts`); buildings/settlers are unmeasured and unshaded. Render-only data — the
   * sim never reads it.
   */
  readonly brightness?: readonly number[];
}
