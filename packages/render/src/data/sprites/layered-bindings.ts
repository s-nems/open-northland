/**
 * A plain bob id draws from the kind's default atlas layer; a `{ layer, bob }` draws from that named
 * family atlas (the rock/mine/pile/flag `.bmd`s), each of which has its own frame-id space.
 */
export type LayeredBobRef = number | { readonly layer: string; readonly bob: number };

/**
 * A building's default layer is the shared `ls_houses_viking.house01`; a named family is a type living
 * in its own `.bmd`/palette (the viking HQ in `ls_houses_viking4.bmd`), with its own scale.
 */
export type BuildingBobRef = LayeredBobRef;

export interface BuildingDraw {
  readonly bob: number;
  readonly layer?: string;
}

/** The `[GfxHouse]` `LogicType` to `GfxBobId` join, keyed by a building's `buildingType`. */
export interface BuildingTypeBinding {
  readonly byType: Readonly<Record<number, BuildingBobRef>>;
  /** The representative house drawn for a typeId absent from {@link byType}. */
  readonly default: BuildingBobRef;
  /**
   * The `[GfxHouse]` `GfxBobConstructionLayer` from-scratch rows, in the source's stacking (file)
   * order. A type absent here keeps its finished-body draw at every progress.
   */
  readonly constructionByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>;
  /**
   * The `GfxBobConstructionLayer` `upgrade === 1` rows, keyed by the tier being upgraded while the
   * row's bob is the next tier's finished body. A type absent here shows only its old body.
   */
  readonly upgradeByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>;
  /**
   * The `[GfxHouse]` type-4 `GfxOverlay` table (the mill's rotor: the body bob has no blades). The
   * original lists overlays only for the finished body, so a building under construction draws none.
   */
  readonly overlayByType?: Readonly<Record<number, BuildingOverlayRef>>;
}

/** An overlay drawn over the finished body, its two states from the `GfxOverlay` type-4 join. */
export interface BuildingOverlayRef {
  readonly layer?: string;
  /** The still frame drawn while not producing (source state 0). */
  readonly idle?: number;
  /** The spin-cycle frames drawn while producing (source state 1), in source order. */
  readonly working?: readonly number[];
  /** Sim ticks per spin frame (default 1). */
  readonly ticksPerFrame?: number;
}

/** The bob a stage draws while build progress is within `[fromPct, toPct]`, inclusive. */
export interface ConstructionLayerRef {
  readonly bob: number;
  readonly layer?: string;
  readonly fromPct: number;
  readonly toPct: number;
}

/** Per-good bob binding for harvestable `[GfxLandscape]` objects: trees, rocks, mine decals, mushrooms. */
export interface ResourceTypeBinding {
  /** Node frames per `Resource.goodType`, ordered empty to full (the good to `landscapeToHarvest`
   *  record to per-state-bob join, `state 1` first). A non-mined node has a single-frame list. A `null`
   *  entry is a data-pinned invisible level, where the source record names a bob its own atlas does not
   *  hold (freshly-sown wheat: state 1 names bob 4000); that level draws nothing, deliberately not the
   *  placeholder, which flags a missing binding instead. */
  readonly byGood: Readonly<Record<number, readonly (LayeredBobRef | null)[]>>;
  /**
   * Node frames keyed by the exact `[GfxLandscape]` record index, one per harvest-stage variant ("yew
   * 01" to "cedar 02", every stone and mine decal), in the same order as {@link byGood}. Wins over the
   * per-good entry so a decoded map keeps its species variety; an unbound variant falls back per-good
   * rather than borrowing a wrong frame.
   */
  readonly byGfxIndex?: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** The representative yew drawn for a good absent from {@link byGood}. */
  readonly default: LayeredBobRef;
}

/**
 * The decoded `ls_guidepost.bmd`: bob 0 is the post, bobs 1..18 the board in roughly 20 degree steps
 * around the post-top nail point. Each frame's own offsets carry the pivot, so a board draws at the
 * post's feet anchor.
 */
export interface SignpostBinding {
  readonly post: LayeredBobRef;
  /** Direction-board frames in angular order (index = the scene collector's angle bucket). */
  readonly boards: readonly LayeredBobRef[];
  /**
   * The same frames from that player's baked `ls_guidepost.player_NN` atlas, indexed by owner slot: the
   * original draws a guidepost through the owner's full palette, and its graded edge alpha rules out
   * the characters' indexed LUT path. A missing slot falls back to this binding's own frames.
   */
  readonly byPlayer?: readonly (SignpostBinding | undefined)[];
}

/** A ground pile's per-good heap frames plus the flag an empty collection point draws. */
export interface StockpileBinding {
  /** Heap frames per `goodType` from `ls_goods.<good>`, ordered fewest to most units (the
   *  `landscapeToStore` join). */
  readonly byGood: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** The delivery-flag sprite (`ls_temp` player sign) drawn for a pile holding no goods. */
  readonly flag: LayeredBobRef;
  /** Fallback frame for a held pile whose good has no bound heap frames (drawn at any fill). */
  readonly default: LayeredBobRef;
}
