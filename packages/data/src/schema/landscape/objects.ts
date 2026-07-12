import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

export const LandscapeType = z.strictObject({
  typeId: TypeId,
  id: z.string(),
  /** `name` — the raw display name (`"tree"`, `"stone_ore"`, `"cadaver_leather"`); {@link id} is its slug. */
  name: z.string().optional(),
  walkable: z.boolean().default(true),
  /** LOAD-BEARING default: the extractor keeps `true` here (the source table carries no per-type
   *  build flag), and the sim's placement rule now reads it (`TerrainGraph.isBuildable`). Feeding
   *  extracted landscape rows STRAIGHT into a sim terrain would therefore make water/rock buildable —
   *  real maps must go through the app's collision resolve (semantic classes), never raw. */
  buildable: z.boolean().default(true),
  /**
   * Whether crops may be SOWN on ground of this type (`TerrainGraph.isPlantable` — the farmer drive's
   * field gate). Source basis: the original's `biocanplanton` flag on the GROUND classes
   * (`trianglepatterntypes.cif` — only `land` carries it; sand/beach/desertstone/mountain/snow do
   * not), resolved onto the sim's semantic terrain rows by the app's collision join. Defaults FALSE —
   * `landscapetypes.ini` (this table's extraction source) has no such flag, so an extracted row never
   * becomes sowable by accident; only the semantic ground rows opt in.
   */
  plantable: z.boolean().default(false),
  /**
   * `maximumValency` — the per-cell capacity of this landscape type, the number that gates how many
   * units can share / cluster on a cell of this type in the cell-adjacency graph (Phase 2). The
   * passable terrain types ("void") carry a large value (100); obstacles/decor carry a small one
   * (e.g. trees=5, bushes=1). Defaults to 0 when the source omits it (no record observed without it).
   */
  maxValency: z.number().int().nonnegative().default(0),
  /**
   * `allowedonland` — this type sits on the land layer. Nearly every type sets it (terrain, decor,
   * dropped goods). Defaults false; the placement layer is derived from these flags, not `walkable`.
   */
  allowedOnLand: z.boolean().default(false),
  /** `allowedonwater` — this type sits on the water layer (e.g. walls/gates over water). */
  allowedOnWater: z.boolean().default(false),
  /** `allowedoneverything` — this type sits on any layer (only the "void"/empty type). */
  allowedOnEverything: z.boolean().default(false),
  /**
   * Raw `transition` tuples in file order, each a variable-length int list captured VERBATIM. These
   * drive the landscape lifecycle (how a `tree` becomes a `trunk`, how a mine depletes) but their
   * field semantics are NOT decoded — do not read meaning into the positions here. Most are 5 ints
   * (`transition <a> <b> <c> <d> <e>`), a few `mine` types carry a 2-int form. Kept so a future
   * lifecycle system can consume them once the encoding is reversed. See docs/SOURCES.md.
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
 * The `logicType` value meaning "no logic classification" — the schema default for a record that
 * omits the key (a pure-decor {@link LandscapeGfx}, a misc/border {@link GfxPattern}). Cross-ref
 * checks skip it; every REAL record carries an explicit 1-based id.
 */
export const LOGIC_TYPE_NONE = 0;

/**
 * One growth/valency state's frame list from a `[GfxLandscape]` record's repeated
 * `GfxFrames <state> <bobId…>` lines. For an animated object ({@link LandscapeGfx.loopAnimation})
 * the bob ids are the loop's frames in play order; for a static object they are alternates/stages.
 */
export const LandscapeGfxFrames = z.object({
  /** The `GfxFrames` leading int — the object's growth/remaining-valency state this list draws. */
  state: z.number().int().nonnegative(),
  /** The state's bob ids into the record's {@link LandscapeGfx.bmd} atlas, in file order. */
  bobIds: z.array(z.number().int().nonnegative()),
});
export type LandscapeGfxFrames = z.infer<typeof LandscapeGfxFrames>;

/**
 * One full `[GfxLandscape]` record from `Data/engine2d/inis/landscapes/landscapes.cif` (866 records)
 * — a placeable **landscape object** (tree, stone, bush, mine decal, wave fx, sign, wonder, …): the
 * visual half (`GfxBobLibs` body+shadow `.bmd`, `GfxPalette` recolour, per-state `GfxFrames`,
 * static/loop animation flags) joined to the logic half (`LogicType` → the {@link LandscapeType}
 * table, valency, workability, walk/build/work footprints). A decoded original map places these by
 * **`EditName`** (the map's `eald` dictionary stores the names; its `emla` half-cell lane indexes
 * that dictionary), so the name is the join key from `content/maps/<id>.json` objects to this table.
 *
 * Like {@link GfxPattern}, the record has no explicit id — {@link index} is the 0-based position in
 * the `.cif`, and the extractor keeps every record so positions never renumber. The pure sim ignores
 * the Gfx fields; the Logic fields feed a future object-collision/harvest slice.
 */
export const LandscapeGfx = z.object({
  /** The 0-based position in the `[GfxLandscape]` list (the engine's positional id). */
  index: z.number().int().nonnegative(),
  /** `EditName` — the placement join key (e.g. `"palm 03"`, `"fx wave slow"`). */
  editName: z.string().optional(),
  /** `EditGroups` — editor grouping tags, kept verbatim. */
  editGroups: z.array(z.string()).default([]),
  /** `LogicType` — the {@link LandscapeType.typeId} this object counts as (tree=4, rock=15, …); 0/absent = pure decor. */
  logicType: TypeId.default(0),
  /** `LogicMaximumValency` — the object's harvest/cluster capacity (tree=3, …). */
  maxValency: z.number().int().nonnegative().optional(),
  /** `LogicIsWorkable` — whether a settler can work (harvest) this object. */
  isWorkable: z.boolean().default(false),
  /** Repeated `LogicWalkBlockArea` lines — the walk-collision footprint. */
  walkBlockAreas: z.array(LandscapeBlockArea).default([]),
  /** Repeated `LogicBuildBlockArea` lines — the build-blocking footprint. */
  buildBlockAreas: z.array(LandscapeBlockArea).default([]),
  /** Repeated `LogicWorkArea` lines — where a worker stands to work the object. */
  workAreas: z.array(LandscapeBlockArea).default([]),
  /** `GfxBobLibs` first value — the body bob set, normalized (e.g. `data/engine2d/bin/bobs/ls_trees.bmd`). */
  bmd: z.string().optional(),
  /** `GfxBobLibs` second value — the shadow bob set, normalized, when the record names one. */
  shadowBmd: z.string().optional(),
  /** `GfxPalette` — the recolour skin (lower-cased), keying the `(bmd, palette)` atlas. */
  paletteName: z.string().optional(),
  /** Per-state frame lists (`GfxFrames`), file order. */
  frames: z.array(LandscapeGfxFrames).default([]),
  /** `GfxStatic` — 1 = a still object (no per-frame playback). */
  isStatic: z.boolean().default(true),
  /** `GfxLoopAnimation` — 1 = the state's frame list loops continuously (waves, fire, smoke). */
  loopAnimation: z.boolean().default(false),
  /**
   * `GfxDynamicBackground` — set on exactly the 8 wave records in the real data. Carried for
   * provenance; the renderer no longer branches on it: the waves' watery translucency is their
   * Double8Bit bobs' PER-PIXEL alpha, baked into the atlas by the pipeline (see the asset-pipeline's
   * `AtlasAlphaMode`), not a flat per-record blend.
   */
  dynamicBackground: z.boolean().default(false),
  source: Provenance.optional(),
});
export type LandscapeGfx = z.infer<typeof LandscapeGfx>;

/**
 * One stage of a resolved {@link GatheringPipeline}: a {@link LandscapeType} id plus the
 * {@link LandscapeGfx} records that place it. The `gfxIndices` are the {@link LandscapeGfx.index}
 * values whose `logicType` equals {@link landscapeType} — the join a later gathering system needs to
 * draw the tree/trunk/wood at a cell without re-scanning the 866-record gfx table. Empty when no gfx
 * record carries that logic type (a pure-logic landscape stage with no placeable object).
 */
export const GatheringStage = z.strictObject({
  /** The stage's {@link LandscapeType.typeId} (`landscapeToHarvest`/`Pickup`/`Store`). */
  landscapeType: TypeId,
  /** {@link LandscapeGfx.index} values whose `logicType` == {@link landscapeType} (the placeable gfx for this stage). */
  gfxIndices: z.array(z.number().int().nonnegative()).default([]),
});
export type GatheringStage = z.infer<typeof GatheringStage>;

/**
 * The resolved gathering pipeline for one raw good — the good→landscape→gfx join materialized once
 * at build time from {@link GoodType.gathering} + the {@link LandscapeType} + {@link LandscapeGfx}
 * tables, so a later gathering system reads the three stages (and their placeable gfx) directly
 * instead of re-deriving the join. One record per map-gathered good; produced/in-house goods have
 * none. A stage is absent when the source good omits that lane (honey has no {@link harvest}).
 */
export const GatheringPipeline = z.strictObject({
  /** The good this pipeline yields (`{@link GoodType.typeId}`). */
  goodType: TypeId,
  /** The good's slug, for legibility (`"wood"`, `"stone"`). */
  goodId: z.string(),
  /** `atomicForHarvesting` — the atomic action a settler runs to work the {@link harvest} stage. */
  harvestAtomic: AtomicId.optional(),
  /** `isBioLandscapeFlag` — the pipeline is living/growing (trees, herb) vs mined (stone, ore). */
  bioLandscape: z.boolean().default(false),
  /** Stage 1 — the source object a settler harvests (a `tree`/`rock`/`mine`). Absent for honey. */
  harvest: GatheringStage.optional(),
  /** Stage 2 — the pick-up intermediate (a `trunk`/`ore`). */
  pickup: GatheringStage.optional(),
  /** Stage 3 — the finished good resting on the ground (`wood`/`stone`) until stocked. */
  store: GatheringStage.optional(),
});
export type GatheringPipeline = z.infer<typeof GatheringPipeline>;
