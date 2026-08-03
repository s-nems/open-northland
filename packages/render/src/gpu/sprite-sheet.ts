import type { TextureSource } from 'pixi.js';
import type {
  BuildTimeSheet,
  ByJobTable,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteKind,
} from '../data/sprites/index.js';

/** The player-colour LUT the paletted settler meshes read team colours through. With the optional armor
 *  axis the texture carries one `playerRows`-row block per recolor tier (`row = tier * playerRows +
 *  player`, tier 0 = the plain player rows); a pre-armor 16-row LUT still loads. */
export interface PlayerColourLut {
  readonly source: TextureSource;
  /** The texture's total row count, across every armor-tier block. */
  readonly colours: number;
  /** Rows per armor-tier block (the player-colour count the LUT was composed with). */
  readonly playerRows?: number;
  /** Worn armor `goodType` → its recolor tier (`armortypes.ini` `type`, 1..4). */
  readonly armorTierByGood?: ReadonlyMap<number, number>;
}

/** The `(armor tier, player)` block row when the worn `armorGood` resolves to a tier the texture
 *  actually carries, else the plain player row. */
export function paletteLutRow(
  palette: PlayerColourLut,
  player: number | undefined,
  armorGood: number | null | undefined,
): number {
  const base = player ?? 0; // an unowned settler reads row 0 (the base palette)
  if (armorGood == null || palette.playerRows === undefined) return base;
  const tier = palette.armorTierByGood?.get(armorGood);
  if (tier === undefined) return base;
  const row = tier * palette.playerRows + base;
  return row < palette.colours ? row : base;
}

export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  /**
   * CPU copy of the atlas's build-progress time sheet (the house atlases' sibling `.build.png`), present
   * only when the manifest announced one. Absent, an under-construction building falls back to the
   * bottom-up crop approximation.
   */
  readonly times?: BuildTimeSheet;
  /**
   * The layer's cast-shadow twin: pre-baked translucent-black silhouettes whose frame ids parallel this
   * layer's bob ids, so a drawn bob prepends its same-id shadow frame under the body. Absent, the bob
   * casts none - character atlases never carry one, settlers draw shadow-less by design.
   */
  readonly shadow?: Pick<SpriteLayer, 'source' | 'atlas'>;
}

/**
 * One composited settler look - the original's `[jobbasegraphics]` record. Several jobs may share one
 * character, and each body's sequences live in its own frame-id space, so the binding travels with the
 * layers instead of staying a sheet-global.
 */
export interface SettlerCharacter {
  /** The base layer, whose `[bobseq]` ranges {@link SettlerCharacter.binding} indexes. */
  readonly body: SpriteLayer;
  /**
   * The head looks that can overlay this body (the `gfxbobmanagerhead` slots), drawn at the same bob id
   * as the body frame. One is picked per individual, stable by entity id, matching the original's
   * per-individual random head. Empty for a body-only character whose head is baked into the body bob.
   */
  readonly heads?: readonly SpriteLayer[];
  /** The per-state animation binding resolved against this body's own `[bobseq]` frame ranges. */
  readonly binding: SettlerStateBinding;
  /**
   * The binding the head overlay resolves through when it must differ from {@link binding}: most
   * carry-walk variants ship empty head bobs, so their head plays the walk range at the same (facing,
   * frame) offset while the body carries the load. Absent, heads resolve at the body's own bob id.
   */
  readonly headBinding?: SettlerStateBinding;
}

/**
 * The render-side `[jobbasegraphics]` join: an item's `jobType` (plus its young flag) picks which
 * body/heads/binding compose the settler. A sheet without characters falls back to the sheet-global
 * `bindings.settler` + `source`/`overlays` pair.
 */
export interface SettlerCharacterSet extends ByJobTable<SettlerCharacter> {
  /**
   * The wildlife species looks keyed by the item's animal tribe - the render-side
   * `animals/jobgraphics.ini` join (species body recolour + its own `cr_ani` sequences; animals never
   * carry heads). A tribe listed in `tribes` resolves only here: bound draws its species look, unbound
   * draws nothing, never the human civilian default. The species atlases are baked recolours with no
   * indexed variant, so an animal always draws outside the paletted-LUT path.
   */
  readonly animals?: {
    readonly byTribe: Readonly<Record<number, SettlerCharacter>>;
    /** Every animal-record tribe, bound or not: the "never the human default" membership test. */
    readonly tribes: ReadonlySet<number>;
  };
}

/**
 * A loaded bob atlas ready for the GPU. Optional input to the renderer: when present, bound sprite kinds
 * draw their atlas frame; when absent, or when a kind or frame does not resolve, the placeholder geometry
 * draws instead.
 *
 * `overlays` are extra layers drawn on top of the body in order, each indexed by the same resolved bob id
 * (the head bob shares the body's frame numbering). A layer that lacks the id, or has a 0×0 frame there,
 * is skipped for that bob.
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
  readonly overlays?: readonly SpriteLayer[];
  /**
   * Per-kind dedicated atlas layers. The base `source`/`atlas` (+ `overlays`) is the human body+head set,
   * so a `resource` or a `building` from its own `.bmd` cannot share its bob-id space. A kind listed here
   * is blitted from this layer's own `source`+`atlas` as one feet-anchored sprite with no head overlay; a
   * kind with no entry falls back to the shared body+overlays path.
   */
  readonly kindLayers?: Partial<Record<SpriteKind, SpriteLayer>>;
  /**
   * Per-kind render scale (default 1 = native bob pixels). The art for different kinds was authored at
   * different scales relative to the settler - `ls_houses_*` bobs draw ~6-10× a settler's height at native
   * size - so a listed kind is drawn at that factor about its feet anchor. An approximation that brings
   * the building back into proportion with the native-scale settler and tree.
   */
  readonly kindScales?: Partial<Record<SpriteKind, number>>;
  /**
   * Named building-family atlas layers, the multi-`.bmd` building case: a settlement draws its buildings
   * from many `.bmd` × palette combinations, each a separate decoded atlas with its own frame-id space,
   * which the single {@link kindLayers}.`building` layer cannot address. A binding naming a `layer`
   * present here is blitted from that family's own `source`+`atlas`; every other binding uses
   * {@link kindLayers}.
   */
  readonly families?: Readonly<Record<string, SpriteLayer>>;
  /**
   * Per-family render scale, since each building `.bmd` was authored at its own size relative to the
   * settler. A family with no entry inherits the `building` {@link kindScales} entry, else 1.
   */
  readonly familyScales?: Readonly<Record<string, number>>;
  /**
   * Per-job settler characters (the `[jobbasegraphics]` job → body/head/animation join). When present, a
   * settler draws its job's {@link SettlerCharacter} instead of the sheet-global body (`source`/
   * `overlays`) + `bindings.settler`, which stays the fallback.
   */
  readonly characters?: SettlerCharacterSet;
  /**
   * The `256 × colours` team-colour palette texture the {@link characters} are drawn through when their
   * atlases are the recolourable indexed variant (palette index in red): one indexed atlas plus one LUT
   * serve all `colours` players. Absent, settlers fall back to a plain tinted-atlas sprite.
   */
  readonly palette?: PlayerColourLut;
}
