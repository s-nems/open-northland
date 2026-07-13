/**
 * The LAYERED-kind binding-table types — the data shapes that say which atlas bob (and which named
 * atlas-layer family) a building / resource node / ground pile draws, per type and per good. Content
 * fills these from the extracted IR; the pure {@link import('./layered.js')} resolver consumes them. The
 * settler binding types are the twin file {@link import('./settler-bindings.js')}; the root
 * {@link import('./bindings.js').SpriteBindings} record composes both. No code here beyond type aliases.
 */

/**
 * A bob reference that names WHICH atlas it draws from — the ONE shape every per-kind binding shares
 * (buildings via the {@link BuildingBobRef} alias, per-good resources, stockpiles): a plain bob id draws
 * from the kind's {@link import('../../gpu/sprite-sheet.js').SpriteSheet.kindLayers}
 * layer (the default resource atlas — the tree), a `{ layer, bob }` draws from a named
 * {@link import('../../gpu/sprite-sheet.js').SpriteSheet.families} atlas (the rock/mine/pile/flag `.bmd`s), each
 * with its OWN frame-id space. The GPU resolves it identically for every kind ({@link BuildingDraw}).
 */
export type LayeredBobRef = number | { readonly layer: string; readonly bob: number };

/**
 * A building type's bob reference — a {@link LayeredBobRef} by another (historical) name: either a plain
 * bob id drawn from the **default** building atlas layer (the single shared `ls_houses_viking.house01`
 * layer, {@link import('../../gpu/sprite-sheet.js').SpriteSheet.kindLayers}'s `building` entry), OR a
 * **layer-qualified** `{ layer, bob }` naming WHICH family atlas the bob comes from — the multi-`.bmd`
 * case where a building type lives in its own `.bmd`/palette (e.g. the viking HQ in
 * `ls_houses_viking4.bmd`). A `layer` keys into {@link import('../../gpu/sprite-sheet.js').SpriteSheet.families};
 * the GPU blits the `bob` from that family's own source + frame-id space (and its per-family scale). A bare
 * number keeps the pre-multi-`.bmd` bindings valid unchanged.
 */
export type BuildingBobRef = LayeredBobRef;

/**
 * A resolved building draw ({@link import('./layered.js').resolveBuildingDraw}'s output): which `bob`
 * id, and optionally which named atlas-layer family it draws from. `layer === undefined` means the
 * default building layer ({@link import('../../gpu/sprite-sheet.js').SpriteSheet.kindLayers}'s `building`); a
 * `layer` names a {@link import('../../gpu/sprite-sheet.js').SpriteSheet.families} entry whose own
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
 * ({@link import('../../gpu/sprite-sheet.js').SpriteSheet.families}) — the multi-`.bmd`/per-palette case.
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
 * resolve in the named {@link import('../../gpu/sprite-sheet.js').SpriteSheet.families} atlas `layer`, or
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
