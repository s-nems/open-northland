import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

export const LandscapeType = z.strictObject({
  typeId: TypeId,
  id: z.string(),
  /** `name` - the raw display name (`"stone_ore"`, `"cadaver_leather"`); {@link id} is its slug. */
  name: z.string().optional(),
  walkable: z.boolean().default(true),
  /** Always `true`: the source table carries no per-type build flag. Real maps must resolve
   *  buildability through the app's semantic collision join, never from this row. */
  buildable: z.boolean().default(true),
  /**
   * Whether crops may be sown on ground of this type. Source basis: the ground classes' `biocanplanton`
   * flag in `trianglepatterntypes.cif` (only `land` carries it), resolved onto the sim's semantic
   * terrain rows by the app's collision join. `landscapetypes.ini` has no such flag, so an extracted
   * row never becomes sowable by accident.
   */
  plantable: z.boolean().default(false),
  /**
   * `maximumValency` - the per-cell capacity gating how many units share a cell in the cell-adjacency
   * graph (void 100, trees 5, bushes 1). Defaults to 0 when the source omits it.
   */
  maxValency: z.number().int().nonnegative().default(0),
  /** `allowedonland` - this type sits on the land layer; the placement layer derives from these flags,
   *  not `walkable`. */
  allowedOnLand: z.boolean().default(false),
  /** `allowedonwater` - this type sits on the water layer (e.g. walls/gates over water). */
  allowedOnWater: z.boolean().default(false),
  /** `allowedoneverything` - this type sits on any layer (only the "void"/empty type). */
  allowedOnEverything: z.boolean().default(false),
  /** `playeridallowed` - a player may own and alter a placed object of this logic type. The readable
   * wall and gate rows set it; ordinary scenery omits it. */
  playerIdAllowed: z.boolean().default(false),
  /**
   * Raw `transition` tuples in file order, captured verbatim. They drive the landscape lifecycle
   * (tree→trunk, mine depletion), but their field semantics are undecoded, so do not read meaning into
   * the positions.
   */
  transitions: z.array(z.array(z.number().int())).default([]),
  source: Provenance.optional(),
});
export type LandscapeType = z.infer<typeof LandscapeType>;

export const LandscapeBlockArea = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);
export type LandscapeBlockArea = z.infer<typeof LandscapeBlockArea>;

/**
 * The `logicType` value meaning "no logic classification", the schema default for a record that omits
 * the key. Cross-reference checks skip it; every real record carries an explicit 1-based id.
 */
export const LOGIC_TYPE_NONE = 0;

/**
 * One growth/valency state's frame list from a `[GfxLandscape]` record's repeated
 * `GfxFrames <state> <bobId…>` lines: the loop's frames in play order for an animated object,
 * alternates or stages for a static one.
 */
export const LandscapeGfxFrames = z.strictObject({
  /** The `GfxFrames` leading int - the growth/remaining-valency state this list draws. */
  state: z.number().int().nonnegative(),
  /** The state's bob ids into the record's {@link LandscapeGfx.bmd} atlas, in file order. */
  bobIds: z.array(z.number().int().nonnegative()),
});
export type LandscapeGfxFrames = z.infer<typeof LandscapeGfxFrames>;

/**
 * One `[GfxLandscape]` record from `Data/engine2d/inis/landscapes/landscapes.cif` - a placeable
 * landscape object (tree, stone, bush, sign, wave fx), joining the visual half (`GfxBobLibs`,
 * `GfxPalette`, per-state `GfxFrames`, static/loop flags) to the logic half (`LogicType` → the
 * {@link LandscapeType} table, valency, workability, footprints).
 *
 * A decoded map places these by `EditName` (stored in the map's `eald` dictionary, indexed by its
 * `emla` half-cell lane), so that name is the join key from `content/maps/<id>.json` objects to this
 * table. The record has no explicit id; {@link index} is its 0-based `.cif` position.
 */
export const LandscapeGfx = z.strictObject({
  /** The 0-based position in the `[GfxLandscape]` list - the engine's positional id. */
  index: z.number().int().nonnegative(),
  /** `EditName` - the placement join key (e.g. `"palm 03"`, `"fx wave slow"`). */
  editName: z.string().optional(),
  /** `EditGroups` - editor grouping tags, kept verbatim. */
  editGroups: z.array(z.string()).default([]),
  /** `LogicType` - the {@link LandscapeType.typeId} this object counts as (tree=4, rock=15); {@link LOGIC_TYPE_NONE} = pure decor. */
  logicType: TypeId.default(LOGIC_TYPE_NONE),
  /** `LogicMaximumValency` - the object's harvest/cluster capacity (tree=3, …). */
  maxValency: z.number().int().nonnegative().optional(),
  /** `LogicIsWorkable` - whether a settler can work (harvest) this object. */
  isWorkable: z.boolean().default(false),
  /** Repeated `LogicWalkBlockArea` lines - the walk-collision footprint. */
  walkBlockAreas: z.array(LandscapeBlockArea).default([]),
  /** Repeated `LogicBuildBlockArea` lines - the build-blocking footprint. */
  buildBlockAreas: z.array(LandscapeBlockArea).default([]),
  /** Repeated `LogicWorkArea` lines - where a worker stands to work the object. */
  workAreas: z.array(LandscapeBlockArea).default([]),
  /** `GfxBobLibs` first value - the body bob set, normalized. */
  bmd: z.string().optional(),
  /** `GfxBobLibs` second value - the shadow bob set, normalized, when the record names one. */
  shadowBmd: z.string().optional(),
  /** `GfxPalette` - the recolour skin (lower-cased), keying the `(bmd, palette)` atlas. */
  paletteName: z.string().optional(),
  /** Per-state frame lists (`GfxFrames`), file order. */
  frames: z.array(LandscapeGfxFrames).default([]),
  /** `GfxStatic` - 1 = a still object (no per-frame playback). */
  isStatic: z.boolean().default(true),
  /** `GfxLoopAnimation` - 1 = the state's frame list loops continuously (waves, fire, smoke). */
  loopAnimation: z.boolean().default(false),
  /**
   * `GfxDynamicBackground` - set on exactly the 8 wave records, carried for provenance. The renderer
   * does not branch on it: the waves' translucency is their Double8Bit bobs' per-pixel alpha, baked
   * into the atlas by the pipeline's `AtlasAlphaMode`.
   */
  dynamicBackground: z.boolean().default(false),
  /**
   * `GfxUserFXMatrix` - the record's bobs hold no colours but a displacement field: each written value
   * lifts the ground drawn beneath by that many pixels (the `fx wave` shore waves). Served as the bob
   * set's `.indexed` atlas, the value in red.
   */
  userFxMatrix: z.boolean().default(false),
  source: Provenance.optional(),
});
export type LandscapeGfx = z.infer<typeof LandscapeGfx>;
