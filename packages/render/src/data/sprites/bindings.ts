import type { DrawKind } from '../scene/index.js';

/**
 * The binding-table TYPES of the sprite layer — the data shapes that say which atlas bob draws each
 * drawable kind (per state, per type, per good). Content fills these from the extracted IR; the pure
 * resolvers ({@link import('./settler.js')}, {@link import('./layered.js')},
 * {@link import('./resolve.js')}) consume them. No code here beyond type aliases — keeping the
 * vocabulary separate from the resolution logic keeps both under a readable size.
 */

/** Atlas-frame kinds the scene binds — the drawable {@link DrawKind}s (terrain tiles bind separately). */
export type SpriteKind = Exclude<DrawKind, 'tile'>;

/**
 * A directional, time-animated bob sequence — the original's `[bobseq]` layout: `dirs` facing
 * directions laid out back-to-back, each `stride` frames long, starting at bob id {@link start}. The
 * frame to draw is `start + facing*stride + (floor(clock / ticksPerFrame) % cycle)`, where `cycle` is
 * {@link frames} (default {@link stride}) — so a settler plays its walk/chop cycle *for the way it
 * faces*, advancing one frame every {@link ticksPerFrame} sim ticks. The cadence is **locked to game
 * ticks, never stretched to fit an action's duration** — that is what keeps every swing the SAME speed
 * (the original's behavior): a 15-tick chop and a 4-tick deposit advance frames at the identical rate.
 * Set `frames: 1` to hold a single still pose per direction (e.g. a standing idle that still turns to
 * face its heading). The facing index comes from {@link import('../scene/index.js').DrawItem.facing}
 * (else {@link import('./settler.js').DEFAULT_FACING}).
 *
 * Whether the sequence loops forever or plays once is **not a property of the animation** — it is which
 * clock {@link import('./settler.js').resolveSettlerBobId} drives it by: a gait (walk) runs on the free
 * `tick` clock (an endless loop), an action (chop) runs on the atomic's own `elapsed` clock and, because
 * the action's `duration` is tuned to a whole number of cycles, plays exactly that many full swings and
 * ends as the action completes — no mid-swing cutoff, no speed that changes with the action length.
 */
export interface DirectionalAnim {
  /** Bob id of direction 0, frame 0 — the sequence's first frame (`startFrame` in `animations.ini`). */
  readonly start: number;
  /** Number of facing directions laid out back-to-back (Cultures humans use 8). */
  readonly dirs: number;
  /** Frames per direction in the source layout — the stride between one direction and the next. */
  readonly stride: number;
  /** Frames to actually cycle through (default {@link stride}); `1` holds a single pose per direction. */
  readonly frames?: number;
  /**
   * Sim ticks per animation frame — the fixed cadence the sequence advances at (default `1`, one frame
   * per tick). Larger values play the sequence slower (a frame is held for several ticks) while keeping
   * it tick-locked and constant-speed. The original's per-`bobseq` frame duration maps here; until it
   * is extracted, `1` is the pinned cadence (see source basis).
   */
  readonly ticksPerFrame?: number;
  /**
   * Frame index within the cycle to START on (default `0`) — the sequence plays
   * `(phaseStart + step) % cycle`. A `[bobseq]` is a CONTINUOUS loop with no inherent first frame, so
   * this rotates where playback begins, letting an action begin and end on meaningful poses. The chop's
   * 15-frame loop is `0..8` = the axe coming DOWN to the tree (the strike) and `9..14` = the axe rising
   * (the windup); `phaseStart: 9` plays windup→strike (9..14, 0..8) so a single chop *starts* by winding
   * up and *ends* on the impact (frame 8). A gait (walk) starts at 0.
   */
  readonly phaseStart?: number;
}

/**
 * A directional animation laid out as **explicit per-facing frame-index lists** — the original's
 * `[gfxanimatomic]` `gfxanimframelistdir` binding (extracted as
 * {@link import('@vinland/data').GfxAnimAtomic}), for an ACTION whose frames are NOT a uniform
 * `start + facing*stride` strip. Each {@link frameLists} entry is one facing's ordered list of LOCAL
 * frame indices into a bobseq pool starting at {@link start} (drawn bob id = `start + frameLists[dir][i]`).
 * The lists differ per facing and author holds/repeats inline (a spear windup repeats its first frame),
 * so playback plays a list verbatim — the reason a melee swing (pool 102/108/150, not divisible by 8)
 * cannot ride {@link DirectionalAnim}. The facing index selects the list ({@link frameLists} length =
 * directions; a length-1 list is facing-locked). Advances one entry every {@link ticksPerFrame} ticks
 * on the driving clock (an action's `elapsed`) — the same tick-locked cadence {@link DirectionalAnim}
 * uses — but ONE-SHOT: past the last entry the sprite shows the FIRST entry, the ready stance, instead
 * of wrapping into a replay (an authored list is one complete motion; only some lists author their own
 * trailing rest pad, so wrapping/holding-the-tail froze mid-swing).
 */
export interface FrameListAnim {
  /** Bob id of the pool's frame 0 — the bobseq `start` the LOCAL {@link frameLists} indices add to. */
  readonly start: number;
  /** Per-facing ordered lists of local frame indices into the pool; outer length = facing directions. */
  readonly frameLists: readonly (readonly number[])[];
  /** Sim ticks per animation frame — the fixed cadence (default `1`), like {@link DirectionalAnim.ticksPerFrame}. */
  readonly ticksPerFrame?: number;
}

/** A frame reference in a settler binding: a fixed bob id, a uniform {@link DirectionalAnim}, or an
 *  explicit per-facing {@link FrameListAnim} (the `[gfxanimatomic]` directional action layout). */
export type SpriteFrameRef = number | DirectionalAnim | FrameListAnim;

/**
 * A settler's per-state frames — which atlas bob to draw for each coarse
 * {@link import('../scene/index.js').SpriteState}. This is the richer binding the plan calls for: a
 * settler walking shows its `moving` bob, one mid-swing its `acting` bob (the original keys these off
 * `tribetypes` `setatomic`, atomic → animation). `idle` is the required base; `moving`/`acting` are
 * optional and fall back to `idle` when absent, and an `acting` settler can bind a *specific* atomic id
 * via {@link SettlerStateBinding.byAtomic} (so chop vs carry pick different frames) — `acting` is the
 * generic-action fallback when an atomic isn't listed.
 *
 * Each slot is a {@link SpriteFrameRef}: a plain bob id (one still frame for every facing/tick) **or** a
 * {@link DirectionalAnim} (a per-facing, per-tick animated sequence). A bare id stays valid, so the
 * earlier single-frame bindings need no change.
 */
export interface SettlerStateBinding {
  /** Required base frame — used when no more-specific state frame is bound. */
  readonly idle: SpriteFrameRef;
  /** Frame(s) while following a path. Falls back to {@link idle} when absent. */
  readonly moving?: SpriteFrameRef;
  /** Frame(s) while executing any atomic (the generic action). Falls back to {@link idle}. */
  readonly acting?: SpriteFrameRef;
  /**
   * Per-atomic-id override for the `acting` state (the `setatomic` join: atomic id → its frame(s)), so
   * e.g. chop(24) and pickup(22) draw different animations. A miss falls back to {@link acting} then
   * {@link idle}.
   */
  readonly byAtomic?: Readonly<Record<number, SpriteFrameRef>>;
  /**
   * Loaded-gait override, in effect only while the draw item is hauling a good
   * ({@link import('../scene/index.js').DrawItem.carrying}). A carrier swaps its empty-handed walk/stand
   * for these (the original's `..._walk_wood` bobseq vs the plain `..._walk`): `moving` while walking a
   * load home, `idle` while standing or depositing it. Each slot falls back to its un-loaded counterpart
   * when absent, so a binding that omits `carrying` is unchanged — and a *bound* atomic animation (e.g.
   * the chop in {@link byAtomic}) still wins, since a settler only carries *after* it has finished
   * harvesting empty-handed.
   */
  readonly carrying?: CarryingBinding;
  /**
   * **Combat-engaged** gait override — the original's `..._walk_agressive` / `..._wait_agressive`
   * bobseqs a soldier plays while advancing on or standing off against an enemy (its weapon readied),
   * distinct from the relaxed economy walk/wait. In effect only while the draw item is
   * {@link import('../scene/index.js').DrawItem.engaged} (the sim `Engagement` marker): `moving` swaps the
   * approach walk, `idle` the ready stance. Each slot falls back to its un-engaged counterpart when absent
   * (the unarmed body authors no aggressive variant), so a spec that omits it is unchanged. A bound
   * atomic (the attack swing in {@link byAtomic}) still wins while the unit is mid-swing — engagement only
   * colours the walk/stand around the blow.
   */
  readonly engaged?: {
    readonly idle?: SpriteFrameRef;
    readonly moving?: SpriteFrameRef;
  };
}

/**
 * The loaded-gait slots of a {@link SettlerStateBinding}: the generic hauling look (`idle`/`moving`)
 * plus an optional **per-good** table. The original draws a DIFFERENT carry cycle per hauled good
 * (`human_man_generic_walk_wood` for a log, `_walk_stone`, `_walk_fish`, …); {@link byGood} keys those
 * on the sim's `Carrying.goodType` ({@link import('../scene/index.js').DrawItem.carryGood}), so a
 * settler hauling bread shows the bread walk, one hauling stone the stone slab. A good absent from the
 * table falls back to the generic `idle`/`moving` slots (then to the un-loaded counterparts), so a
 * sparse table is always total.
 */
export interface CarryingBinding {
  readonly idle?: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  /** Per-`goodType` hauling look (the `..._walk_<good>` bobseq join); a miss uses the generic slots. */
  readonly byGood?: Readonly<
    Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }>
  >;
}

/**
 * A bob reference that names WHICH atlas it draws from — the ONE shape every per-kind binding shares
 * (buildings via the {@link BuildingBobRef} alias, per-good resources, stockpiles): a plain bob id draws
 * from the kind's {@link import('../../gpu/pixi-app.js').SpriteSheet.kindLayers}
 * layer (the default resource atlas — the tree), a `{ layer, bob }` draws from a named
 * {@link import('../../gpu/pixi-app.js').SpriteSheet.families} atlas (the rock/mine/pile/flag `.bmd`s), each
 * with its OWN frame-id space. The GPU resolves it identically for every kind ({@link BuildingDraw}).
 */
export type LayeredBobRef = number | { readonly layer: string; readonly bob: number };

/**
 * A building type's bob reference — a {@link LayeredBobRef} by another (historical) name: either a plain
 * bob id drawn from the **default** building atlas layer (the single shared `ls_houses_viking.house01`
 * layer, {@link import('../../gpu/pixi-app.js').SpriteSheet.kindLayers}'s `building` entry), OR a
 * **layer-qualified** `{ layer, bob }` naming WHICH family atlas the bob comes from — the multi-`.bmd`
 * case where a building type lives in its own `.bmd`/palette (e.g. the viking HQ in
 * `ls_houses_viking4.bmd`). A `layer` keys into {@link import('../../gpu/pixi-app.js').SpriteSheet.families};
 * the GPU blits the `bob` from that family's own source + frame-id space (and its per-family scale). A bare
 * number keeps the pre-multi-`.bmd` bindings valid unchanged.
 */
export type BuildingBobRef = LayeredBobRef;

/**
 * A resolved building draw ({@link import('./layered.js').resolveBuildingDraw}'s output): which `bob`
 * id, and optionally which named atlas-layer family it draws from. `layer === undefined` means the
 * default building layer ({@link import('../../gpu/pixi-app.js').SpriteSheet.kindLayers}'s `building`); a
 * `layer` names a {@link import('../../gpu/pixi-app.js').SpriteSheet.families} entry whose own
 * atlas/source the `bob` indexes.
 */
export interface BuildingDraw {
  readonly bob: number;
  readonly layer?: string;
}

/**
 * A building's per-type bob binding — the original's `[GfxHouse]` `LogicType` → `GfxBobId` join, so
 * each building type draws ITS own house bob (a home, a well, a bakery, …) instead of one shared frame.
 * {@link byType} maps a building's `buildingType` ({@link import('../scene/index.js').DrawItem.typeId})
 * to its {@link BuildingBobRef}; a type absent from it falls back to {@link default} (the representative
 * house). A plain-number ref draws from the shared building atlas layer; a layer-qualified
 * `{ layer, bob }` ref draws from a per-family atlas
 * ({@link import('../../gpu/pixi-app.js').SpriteSheet.families}) — the multi-`.bmd`/per-palette case.
 */
export interface BuildingTypeBinding {
  /** Bob ref per building typeId — the `[GfxHouse]` `LogicType` → `GfxBobId` table (optionally layer-qualified). */
  readonly byType: Readonly<Record<number, BuildingBobRef>>;
  /** Bob ref for a typeId absent from {@link byType} — the fallback house (optionally layer-qualified). */
  readonly default: BuildingBobRef;
  /**
   * Construction-stage layers per building typeId — the `[GfxHouse]` `GfxBobConstructionLayer` table
   * (from-scratch rows only), each type's layers in the source's stacking (file) order. An
   * under-construction {@link import('../scene/index.js').DrawItem} (`builtPct` present) draws every
   * layer whose `[fromPct, toPct]` range contains its progress, stacked in list order
   * ({@link import('./layered.js').resolveConstructionDraws}) — the grey foundation alone at 0%, rising
   * stages after. A type absent here (or a table-less binding) keeps its normal finished-body draw at
   * every progress.
   */
  readonly constructionByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>;
  /**
   * Animated state overlays per building typeId — the `[GfxHouse]` type-4 `GfxOverlay` table (the
   * MILL's rotor: the body bob has no blades; the rotor is this extra sprite drawn on top). A
   * FINISHED building whose type is here draws its overlay above the body: the {@link
   * BuildingOverlayRef.working} spin cycle while the building runs a production cycle
   * ({@link import('../scene/index.js').DrawItem.working}), else the still
   * {@link BuildingOverlayRef.idle} blade frame. An under-construction building draws no overlay
   * (the original lists overlays only for the finished body).
   */
  readonly overlayByType?: Readonly<Record<number, BuildingOverlayRef>>;
}

/**
 * One building type's animated state overlay (the `[GfxHouse]` `GfxOverlay` type-4 join): the extra
 * sprite drawn ON TOP of the finished body — the mill's rotor. `idle` is the single standing-still
 * frame (source state 0); `working` the spin-cycle frame list (source state 1), advanced one frame
 * every {@link ticksPerFrame} sim ticks on the free tick clock (an endless loop, like a gait) while
 * the building is producing. Either state may be absent (that state then draws no overlay). Bobs
 * resolve in the named {@link import('../../gpu/pixi-app.js').SpriteSheet.families} atlas `layer`, or
 * the default building layer when absent — the same rule every {@link BuildingBobRef} follows.
 */
export interface BuildingOverlayRef {
  readonly layer?: string;
  /** The still blade frame drawn while NOT producing (source state 0). */
  readonly idle?: number;
  /** The spin-cycle frames drawn while producing (source state 1), in source order. */
  readonly working?: readonly number[];
  /** Sim ticks per spin frame (default 1) — the tick-locked cadence, like {@link DirectionalAnim.ticksPerFrame}. */
  readonly ticksPerFrame?: number;
}

/**
 * One construction-stage layer of a building type: the bob to draw (optionally from a named atlas-layer
 * family, like {@link BuildingBobRef}) while build progress is within `[fromPct, toPct]` (inclusive).
 */
export interface ConstructionLayerRef {
  readonly bob: number;
  readonly layer?: string;
  readonly fromPct: number;
  readonly toPct: number;
}

/**
 * A resource node's per-good bob binding — the {@link BuildingTypeBinding} twin for harvestable objects,
 * so each good's node draws ITS own decoded `[GfxLandscape]` object (a tree for wood, a rock for stone, a
 * mine decal for iron/gold/clay, a mushroom) instead of one shared yew bob. {@link byGood} maps a node's
 * `Resource.goodType` ({@link import('../scene/index.js').DrawItem.goodType}) to its per-LEVEL frames,
 * ordered **empty→full** (the mine record's fill states, `state 1` first);
 * {@link import('./layered.js').resolveResourceDraw} indexes them by the node's
 * {@link import('../scene/index.js').DrawItem.level} (a mined deposit's shrink-by-level fill), clamped —
 * so a mined deposit visibly shrinks, while a plain node (no level: a tree/mushroom/full deposit) draws
 * the full (last) frame. A good absent from it falls back to {@link default} (the representative yew
 * tree). A bare-number ref draws from the shared resource atlas layer (`ls_trees.tree_yew01`); a
 * layer-qualified `{ layer, bob }` ref draws from a per-`.bmd` family atlas (`ls_ground`/`ls_mushrooms`
 * — the mine/mushroom case).
 */
export interface ResourceTypeBinding {
  /** Per-`goodType` node frames ordered EMPTY→FULL — the good→`landscapeToHarvest`-record→per-state-bob
   *  join (each optionally layer-qualified). A non-mined node has a single-frame list (drawn at any level).
   *  A `null` entry is a data-pinned INVISIBLE level — the source record names a bob its own atlas doesn't
   *  hold (the original's freshly-sown wheat: state 1 → bob 4000, an out-of-atlas "draw nothing" sentinel);
   *  that level draws nothing at all, deliberately NOT the placeholder (which flags a missing binding). */
  readonly byGood: Readonly<Record<number, readonly (LayeredBobRef | null)[]>>;
  /**
   * Per-VARIANT node frames keyed by the node's exact source `[GfxLandscape]` record index
   * ({@link import('../scene/index.js').DrawItem.gfxIndex}) — one entry per harvest-stage variant
   * ("yew 01" … "cedar 02", every stone/mine decal), same EMPTY→FULL frame order as {@link byGood}.
   * Wins over the per-good entry when the item names a bound variant, so a decoded map's placements
   * keep their full original species variety; a variant absent here (an unloaded family atlas) falls
   * back per-good, never borrowing a wrong frame.
   */
  readonly byGfxIndex?: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** Bob ref for a good absent from {@link byGood} — the fallback node (the representative yew tree). */
  readonly default: LayeredBobRef;
}

/**
 * A ground pile / delivery flag's binding — the {@link ResourceTypeBinding} twin for a bare
 * `Stockpile+Position`. A HELD pile draws its good's `[GfxLandscape]` `landscapeToStore` heap
 * (`ls_goods.<good>` — a wood/stone/iron/clay/gold/mushroom pile) at a per-fill frame; an EMPTY pile
 * (a designated collection point) draws the {@link flag} sprite (`ls_temp` player sign).
 *
 * {@link byGood} maps a pile's dominant `goodType` ({@link import('../scene/index.js').DrawItem.goodType})
 * to its heap frames ordered **fewest→most units**;
 * {@link import('./layered.js').resolveStockpileDraw} indexes them by the pile's
 * {@link import('../scene/index.js').DrawItem.fill} amount (clamped), so the heap visibly grows.
 * A good with no bound frames falls back to {@link default}.
 */
export interface StockpileBinding {
  /** Per-`goodType` ground-pile heap frames, ordered fewest→most units (the `landscapeToStore` join). */
  readonly byGood: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** The delivery-flag sprite drawn for an EMPTY pile (a collection point holding no goods). */
  readonly flag: LayeredBobRef;
  /** Fallback frame for a held pile whose good has no bound heap frames (drawn at any fill). */
  readonly default: LayeredBobRef;
}

/**
 * Which atlas bob id draws a given drawable kind. The minimal binding is one representative still
 * frame per kind (`settler` / `building` / `resource`). The settler entry may instead be a
 * {@link SettlerStateBinding} — a per-{@link import('../scene/index.js').SpriteState} (and
 * per-atomic-id) table — for the richer animation binding (a settler's walk/chop frames, keyed off
 * `tribetypes` `setatomic`); the building entry may be a {@link BuildingTypeBinding} — a
 * per-{@link import('../scene/index.js').DrawItem.typeId} table — so each building type draws its own
 * house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join). A plain number stays valid for either
 * (back-compat: it's the all-types/all-states frame), so old bindings need no change.
 *
 * The `resource` entry may likewise be a {@link ResourceTypeBinding} (a per-good node table) and the
 * optional `stockpile` a {@link StockpileBinding} (per-good ground piles + a delivery flag) — the
 * gathering-economy bindings. A plain-number `resource` and an absent `stockpile` keep old sheets valid
 * (the synthetic marker sheet, older callers): a stockpile with no binding just draws the placeholder box.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  stockpile?: number | StockpileBinding;
  /** A felled tree's stump/debris binding — the {@link ResourceTypeBinding} twin for a `Stump` decor
   *  entity, drawn per-good from the dead-tree/debris atlas (`ls_trees_dead`). Reuses the resource
   *  resolver ({@link import('./layered.js').resolveResourceDraw}); absent keeps old sheets valid
   *  (stump draws the placeholder). */
  stump?: number | ResourceTypeBinding;
  /** A loose dropped-wood binding — the {@link ResourceTypeBinding} twin for a `GroundDrop` entity, the
   *  freshly-felled trunk lying on the ground (the `landscapeToPickup` stage) BEFORE a collector carries
   *  it off. Drawn per-good like the node; absent keeps old sheets valid (the drop draws the placeholder). */
  trunk?: number | ResourceTypeBinding;
  /** A wild berry bush binding — the {@link ResourceTypeBinding} twin for a `BerryBush` entity, drawn per
   *  fruited-record variant (`byGfxIndex`) with a two-frame level list (1 = bare, 2 = ripe) so the drawn
   *  bush tracks its forage/regrow state. Reuses the resource resolver ({@link import('./layered.js').resolveResourceDraw});
   *  absent keeps old sheets valid (a bush draws the placeholder). */
  berrybush?: number | ResourceTypeBinding;
}>;

/**
 * A job-keyed lookup with a **young** (age-class) side table and a total fallback — the shape the
 * per-character settler binding uses ({@link import('../../gpu/pixi-app.js').SettlerCharacterSet}), kept
 * generic + pure here so the pick is unit-testable without GPU layers.
 *
 * Why two tables: the original's age classes reuse LOW `jobtypes` ids (1..4 = baby/child), and a
 * synthetic fixture's adult job ids can collide with them (the demo woodcutter is jobType 1 — the real
 * `baby_female` id; see AGENTS.md [dc3ef54]). The sim disambiguates by the `Age` component (only a
 * born-young settler carries one), so the pick does too: a **young** item keys
 * {@link ByJobTable.youngByJob}, an adult keys {@link ByJobTable.byJob}, and any miss (including a
 * `null`-job idle adult) lands on {@link ByJobTable.default} — a fixture's adult "jobType 1" can never
 * draw the baby body.
 */
export interface ByJobTable<T> {
  /** Adult looks by `jobType` (e.g. woman 5, the soldier family 31..41). */
  readonly byJob: Readonly<Record<number, T>>;
  /** Looks for an `Age`-carrying (born-young) settler, keyed by its age-class `jobType` (1..4). */
  readonly youngByJob?: Readonly<Record<number, T>>;
  /**
   * A warrior's look by its EQUIPPED weapon good — so the drawn weapon follows the equipment weapon
   * slot, not the job ("a warrior is one profession; the weapon in hand decides the look"). Wins over
   * the job pick when the settler carries a mapped weapon good; an empty/unmapped slot falls through to
   * {@link byJob} (so a bare warrior draws its job body, a civilian its civilian body).
   */
  readonly byWeaponGood?: Readonly<Record<number, T>>;
  /** The total fallback — the generic look every unmapped job resolves to. */
  readonly default: T;
}
