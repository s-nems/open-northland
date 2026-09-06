import type { TextureSource } from 'pixi.js';
import type { InHouseProgramLookup } from '../data/scene/index.js';
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
  /** Total row count, across every armor-tier block. */
  readonly colours: number;
  /** Rows per armor-tier block. */
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
  const base = player ?? 0; // player 0 is a block's base palette row
  if (armorGood == null || palette.playerRows === undefined) return base;
  const tier = palette.armorTierByGood?.get(armorGood);
  if (tier === undefined) return base;
  const row = tier * palette.playerRows + base;
  return row < palette.colours ? row : base;
}

export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  /** CPU copy of the atlas's build-progress time sheet (the house atlases' sibling `.build.png`),
   *  present only when the manifest announced one. */
  readonly times?: BuildTimeSheet;
  /** The layer's cast-shadow twin, whose frame ids parallel this layer's bob ids so one lookup serves
   *  both. Absent, the bob casts none - character atlases never carry one, so settlers draw shadow-less
   *  by design. */
  readonly shadow?: Pick<SpriteLayer, 'source' | 'atlas'>;
}

/** One composited settler look - the original's `[jobbasegraphics]` record. Each body's sequences live
 *  in its own frame-id space, so the binding travels with the layers. */
export interface SettlerCharacter {
  readonly body: SpriteLayer;
  /** The head looks that can overlay this body (the `gfxbobmanagerhead` slots). Empty for a body-only
   *  character whose head is baked into the body bob. */
  readonly heads?: readonly SpriteLayer[];
  readonly binding: SettlerStateBinding;
  /** The binding the head overlay resolves through when it must differ from {@link binding}. Absent,
   *  heads resolve at the body's own bob id. */
  readonly headBinding?: SettlerStateBinding;
}

/** The render-side `[jobbasegraphics]` join: a settler's weapon, then its job and young flag, pick which
 *  body/heads/binding compose it. */
export interface SettlerCharacterSet extends ByJobTable<SettlerCharacter> {
  /**
   * The wildlife species looks keyed by the item's animal tribe - the render-side
   * `animals/jobgraphics.ini` join. A tribe listed in `tribes` resolves only here: bound draws its
   * species look, unbound draws nothing, never the human civilian default.
   */
  readonly animals?: {
    readonly byTribe: Readonly<Record<number, SettlerCharacter>>;
    /** Every animal-record tribe, bound or not - the membership test above. */
    readonly tribes: ReadonlySet<number>;
  };
}

/**
 * A loaded bob atlas ready for the GPU. `overlays` are extra layers drawn on top of the body in order,
 * each indexed by the same resolved bob id (the head bob shares the body's frame numbering).
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
  readonly overlays?: readonly SpriteLayer[];
  /** Per-kind dedicated atlas layers. The base `source`/`atlas` (+ `overlays`) is the human body+head
   *  set, so a `resource` or a `building` from its own `.bmd` cannot share its bob-id space. */
  readonly kindLayers?: Partial<Record<SpriteKind, SpriteLayer>>;
  /** Per-kind render scale, default 1 = native bob pixels, applied about the feet anchor. */
  readonly kindScales?: Partial<Record<SpriteKind, number>>;
  /** Named building-family atlas layers, the multi-`.bmd` building case: a settlement draws its
   *  buildings from many `.bmd` × palette combinations, each a separate decoded atlas with its own
   *  frame-id space, which the single `building` kind layer cannot address. */
  readonly families?: Readonly<Record<string, SpriteLayer>>;
  /** Per-family render scale, since each building `.bmd` was authored at its own size relative to the
   *  settler. */
  readonly familyScales?: Readonly<Record<string, number>>;
  /** Per-job settler characters. Absent, a settler draws the sheet-global body (`source`/`overlays`) +
   *  `bindings.settler`. */
  readonly characters?: SettlerCharacterSet;
  /** The `256 × colours` team-colour palette texture the {@link characters} are drawn through when their
   *  atlases are the recolourable indexed variant (palette index in red): one indexed atlas plus one LUT
   *  serve all `colours` players. */
  readonly palette?: PlayerColourLut;
  /** The indoor craft choreography the scene draws a working craftsman from. */
  readonly inHousePrograms?: InHouseProgramLookup;
}
