/**
 * A plain bob id draws from the kind's default atlas layer; a `{ layer, bob }` draws from that named
 * family atlas, which has its own frame-id space.
 */
export type LayeredBobRef = number | { readonly layer: string; readonly bob: number };

export type BuildingBobRef = LayeredBobRef;

export interface BuildingDraw {
  readonly bob: number;
  readonly layer?: string;
}

export interface BuildingTypeBinding {
  readonly byType: Readonly<Record<number, BuildingBobRef>>;
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
  /** The `[GfxHouse]` type-4 `GfxOverlay` table. The original lists overlays only for the finished body,
   *  so a building under construction draws none. */
  readonly overlayByType?: Readonly<Record<number, BuildingOverlayRef>>;
}

export interface BuildingOverlayRef {
  readonly layer?: string;
  /** The still frame drawn while not producing (source state 0). */
  readonly idle?: number;
  /** The spin-cycle frames drawn while producing (source state 1), in source order. */
  readonly working?: readonly number[];
  /** Sim ticks per spin frame (default 1). */
  readonly ticksPerFrame?: number;
}

/** One stage of a construction or upgrade stack. Each stack reads the window its own way: a
 *  construction stage draws from `fromPct` until covered, an upgrade stage only within `[fromPct,
 *  toPct]`. */
export interface ConstructionLayerRef {
  readonly bob: number;
  readonly layer?: string;
  readonly fromPct: number;
  readonly toPct: number;
}

/** Per-good bob binding for a `[GfxLandscape]` object family. */
export interface ResourceTypeBinding {
  /** Node frames per `Resource.goodType`, ordered empty to full (`state 1` first). A `null` entry is a
   *  data-pinned invisible level: that level draws nothing, deliberately not the placeholder, which
   *  flags a missing binding instead. */
  readonly byGood: Readonly<Record<number, readonly (LayeredBobRef | null)[]>>;
  /**
   * Node frames keyed by the exact `[GfxLandscape]` record index, in the same order as {@link byGood}.
   * Wins over the per-good entry so a decoded map keeps its species variety; an unbound variant falls
   * back per-good rather than borrowing a wrong frame.
   */
  readonly byGfxIndex?: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** This binding's own representative frame, drawn for a good absent from {@link byGood}. */
  readonly default: LayeredBobRef;
}

/** Each frame's own offsets carry the pivot, so a board draws at the post's feet anchor. */
export interface SignpostBinding {
  readonly post: LayeredBobRef;
  /** Index = the scene collector's angle bucket. */
  readonly boards: readonly LayeredBobRef[];
  /**
   * The same frames from that player's baked `ls_guidepost.player_NN` atlas, indexed by owner slot: the
   * original draws a guidepost through the owner's full palette, and its graded edge alpha rules out
   * the characters' indexed LUT path. A missing slot falls back to this binding's own frames.
   */
  readonly byPlayer?: readonly (SignpostBinding | undefined)[];
}

export interface StockpileBinding {
  /** Heap frames per `goodType`, ordered fewest to most units. */
  readonly byGood: Readonly<Record<number, readonly LayeredBobRef[]>>;
  /** The delivery-flag sprite drawn for a pile holding no goods. */
  readonly flag: LayeredBobRef;
  /** Fallback frame for a held pile whose good has no bound heap frames, drawn at any fill. */
  readonly default: LayeredBobRef;
}
