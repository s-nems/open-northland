import type { TextureSource } from 'pixi.js';
import type { DrawItem, InHouseProgramLookup } from '../data/scene/index.js';
import type {
  BuildTimeSheet,
  ByJobTable,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteKind,
} from '../data/sprites/index.js';
import type { ClothIndexRanges } from './cloth-wind.js';
import type { ResolvedLayer } from './sprite-pool/resolved-layer.js';

/** A `256 x colours` palette LUT the paletted meshes read an indexed atlas through. */
export interface PaletteLut {
  readonly source: TextureSource;
  /** Total row count. */
  readonly colours: number;
}

/**
 * The owner-colour LUT of the vehicles whose look is {@link VehicleLook.indexed} (the ships' palette
 * family): row `n` is the family's member `n + 1`. Approximation: the family has fewer members than
 * there are player colours, so an owner past the last row wraps around.
 */
export interface VehicleColourLut extends PaletteLut {
  /** The palette indices each indexed atlas paints its sails with, by family stem; an atlas absent
   *  here draws its sails rigid. */
  readonly sailRanges?: Readonly<Record<string, ClothIndexRanges>>;
}

/** The row a vehicle of `player` reads. */
export function vehicleLutRow(palette: PaletteLut, player: number | undefined): number {
  return (player ?? 0) % palette.colours;
}

/** The player-colour LUT the paletted settler meshes read team colours through. The texture carries one
 *  `playerRows`-row block per recolor tier (`row = tier * playerRows + player`, tier 0 = the plain
 *  player rows), then the head row. */
export interface PlayerColourLut extends PaletteLut {
  /** Rows per armor-tier block. */
  readonly playerRows: number;
  /** Worn armor `goodType` → its recolor tier (`armortypes.ini` `type`, 1..4). */
  readonly armorTierByGood: ReadonlyMap<number, number>;
  /** The row after the blocks, which a head overlay reads: the original composes a head palette apart
   *  from the body's, and the team recipes patch the body's bands only. */
  readonly headRow: number;
}

/** The `(armor tier, player)` block row when the worn `armorGood` resolves to a tier the texture
 *  actually carries, else the plain player row. */
export function paletteLutRow(
  palette: PlayerColourLut,
  player: number | undefined,
  armorGood: number | null | undefined,
): number {
  const base = player ?? 0; // player 0 is a block's base palette row
  if (armorGood == null) return base;
  const tier = palette.armorTierByGood.get(armorGood);
  if (tier === undefined) return base;
  const row = tier * palette.playerRows + base;
  return row < palette.headRow ? row : base;
}

/** The row one resolved layer reads: the head row for a head overlay, else the body's `bodyRow`. */
export function layerLutRow(
  palette: PlayerColourLut,
  layer: Pick<ResolvedLayer, 'head'>,
  bodyRow: number,
): number {
  return layer.head === true ? palette.headRow : bodyRow;
}

export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly sway?: number;
  /** CPU copy of the atlas's build-progress time sheet (the house atlases' sibling `.build.png`),
   *  present only when the manifest announced one. */
  readonly times?: BuildTimeSheet;
  /** Optional shadow frames share the body's frame ids and feet anchor. */
  readonly shadow?: Pick<SpriteLayer, 'source' | 'atlas'>;
}

/** One composited settler look - the original's `[jobbasegraphics]` record. Each body's sequences live
 *  in its own frame-id space, so the binding travels with the layers. */
export interface SettlerCharacter {
  readonly body: SpriteLayer;
  /** Complete appearances selected stably by entity id. */
  readonly variants?: readonly Omit<SettlerCharacter, 'variants'>[];
  readonly interpolateMotion?: boolean;
  readonly scale?: number;
  /** The head looks that can overlay this body (the `gfxbobmanagerhead` slots). Empty for a body-only
   *  character whose head is baked into the body bob. */
  readonly heads?: readonly SpriteLayer[];
  readonly binding: SettlerStateBinding;
  /** The binding the head overlay resolves through when it must differ from {@link binding}. Absent,
   *  heads resolve at the body's own bob id. */
  readonly headBinding?: SettlerStateBinding;
}

/** The render-side `[jobbasegraphics]` join: a settler's tribe picks the table, then its weapon, job and
 *  young flag pick which body/heads/binding compose it. The base table serves an item of no or an
 *  unloaded tribe. */
export interface SettlerCharacterSet extends ByJobTable<SettlerCharacter> {
  /** The other loaded civilizations' looks, keyed by `Settler.tribe`. */
  readonly byTribe?: Readonly<Record<number, ByJobTable<SettlerCharacter>>>;
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
 * The palette row for one indexed settler body. A fixed-by-job character is an authored identity (the
 * hero bodies), not a generic soldier body: its armor still affects combat and equipment, but does not
 * select an armor-colour block. The base player row remains active for any authored team-colour pixels.
 */
export function settlerPaletteLutRow(
  sheet: Pick<SpriteSheet, 'palette' | 'characters'> | undefined,
  item: DrawItem,
): number {
  const palette = sheet?.palette;
  if (palette === undefined) return 0;
  const table =
    (item.tribe !== undefined ? sheet?.characters?.byTribe?.[item.tribe] : undefined) ?? sheet?.characters;
  const fixedCharacter =
    item.kind === 'settler' &&
    item.young !== true &&
    item.jobType !== undefined &&
    table?.fixedByJob?.[item.jobType] !== undefined;
  return paletteLutRow(palette, item.player, fixedCharacter ? undefined : item.armorGood);
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
  /** The LUT the indexed vehicle looks are drawn through per owner; absent draws the baked looks. */
  readonly vehiclePalette?: VehicleColourLut;
  /** The indoor craft choreography the scene draws a working craftsman from. */
  readonly inHousePrograms?: InHouseProgramLookup;
  /** Persistent holy-fire effects anchored to mature homes. */
  readonly holyFire?: import('../data/scene/holy-fire.js').HolyFireLookup;
}
