import type { TextureSource } from 'pixi.js';
import type { CartRecipe, CharacterPalette } from '../data/palettes/human-palettes.js';
import type { InHouseProgramLookup } from '../data/scene/index.js';
import type {
  BuildTimeSheet,
  ByJobTable,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteKind,
} from '../data/sprites/index.js';
import type { ClothIndexRanges } from './cloth-wind.js';
import type { HumanPaletteLut } from './human-palette-lut.js';

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

/**
 * A cart drawn as one figure with the driver riding inside it, the original's look for a trader's cart:
 * the `lookJob` character's {@link SettlerStateBinding.cartDrive} gait, whatever the commander's own job,
 * in the driver's palettes with the cart's recipe on top.
 */
export interface CartDriveBinding {
  /** The commander jobs whose ride draws the figure; any other commander leaves the cart's own sprite. */
  readonly commanderJobs: ReadonlySet<number>;
  /** The job whose character draws the figure. */
  readonly lookJob: number;
  /** The cart recipe each cart vehicle type's figure applies to its driver. */
  readonly cartRecipeByVehicleType: Readonly<Record<number, CartRecipe>>;
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
  /** False for a baked body atlas that must bypass the human palette LUT. */
  readonly indexed?: boolean;
  /** The bases and recipes an indexed look composes its palettes from; absent composes the palette
   *  book's fallback base alone. */
  readonly palette?: CharacterPalette;
  /** Complete appearances selected stably by entity id. */
  readonly variants?: readonly Omit<SettlerCharacter, 'variants'>[];
  readonly interpolateMotion?: boolean;
  readonly scale?: number;
  /** Approximation for floating artwork above the entity anchor: project from its visible bottom. */
  readonly castAnchor?: 'body-bottom';
  /** The head looks that can overlay this body (the `gfxbobmanagerhead` slots). Empty for a body-only
   *  character whose head is baked into the body bob. */
  readonly heads?: readonly SpriteLayer[];
  readonly binding: SettlerStateBinding;
  /** The binding the head overlay resolves through when it must differ from {@link binding}. Absent,
   *  heads resolve at the body's own bob id. */
  readonly headBinding?: SettlerStateBinding;
  /** Whether the owner-coloured hero glow surrounds body and head: `always` for a hero look, `never`
   *  for a look that refuses it, absent when only the settler's mission behaviour turns it on. */
  readonly glow?: 'always' | 'never';
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
  /** The per-human palette LUT the {@link characters} are drawn through when their atlases are the
   *  recolourable indexed variant (palette index in red). */
  readonly palette?: HumanPaletteLut;
  /** The LUT the indexed vehicle looks are drawn through per owner; absent draws the baked looks. */
  readonly vehiclePalette?: VehicleColourLut;
  /** The crewed-cart figure; absent draws every cart as its own sprite. */
  readonly cartDrive?: CartDriveBinding;
  /** The indoor craft choreography the scene draws a working craftsman from. */
  readonly inHousePrograms?: InHouseProgramLookup;
  /** Persistent holy-fire effects anchored to mature homes. */
  readonly holyFire?: import('../data/scene/holy-fire.js').HolyFireLookup;
}
