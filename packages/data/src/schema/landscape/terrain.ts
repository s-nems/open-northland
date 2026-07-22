import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';
import { LOGIC_TYPE_NONE } from './objects.js';

export const RgbColor = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
export type RgbColor = z.infer<typeof RgbColor>;

/**
 * One `[trianglepatterntype]` from `Data/logic/trianglepatterntypes.cif` — the logic classification of
 * the terrain triangles (water / land / mountain / sand / beach / desertStone / moor / snow / plaster /
 * blocked): 10 records, `type` ids 1..10. The cross-reference target of a {@link GfxPattern.logicType}.
 * The boolean flags are absent-means-false — the source omits a `0` flag entirely (e.g. the `water`
 * record lists no `humancanwalkon`), so a missing key is `false`, not unknown.
 */
export const TrianglePatternType = z.strictObject({
  /** `type` — the logic-type id (1..10) a {@link GfxPattern.logicType} references. */
  type: TypeId,
  /** `debugname` — the human-readable type label ("water"/"land"/"mountain"/...). */
  debugName: z.string().optional(),
  /** `iswater` — this triangle is water (the sea-valency / boat-and-fish-placement gate). */
  isWater: z.boolean().default(false),
  /** `humancanwalkon` — a settler may walk across this triangle. */
  humanCanWalkOn: z.boolean().default(false),
  /** `housecanbebuildon` — a building may be placed on this triangle. */
  houseCanBeBuildOn: z.boolean().default(false),
  /** `biocangrowon` — vegetation may grow on this triangle. */
  bioCanGrowOn: z.boolean().default(false),
  /** `biocanplanton` — vegetation may be planted on this triangle. */
  bioCanPlantOn: z.boolean().default(false),
  /** `island` — part of a land/island mass (vs open water). */
  island: z.boolean().default(false),
  /** `moveresistance` — relative movement cost across this triangle (a path-cost / gait input). */
  moveResistance: z.number().int().nonnegative().default(0),
  /**
   * `debugcolor` R G B — the flat per-type colour, the fallback tint when the real `text_*` texture is
   * unavailable. `undefined` when absent.
   */
  debugColor: RgbColor.optional(),
  source: Provenance.optional(),
});
export type TrianglePatternType = z.infer<typeof TrianglePatternType>;

/** A triangle's 3 corner UVs into its `text_NNN` texture, as flat pixel coords: `[x0,y0, x1,y1, x2,y2]`. */
export const GfxCoords = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);
export type GfxCoords = z.infer<typeof GfxCoords>;

/**
 * One `[GfxPattern]` from `Data/engine2d/inis/patterns/pattern.cif` — the texture→cell binding for the
 * triangle-mesh terrain (927 records). A pattern names a `text_NNN.pcx` ground texture and the two
 * triangles' UVs ({@link coordsA}/{@link coordsB}) that tile a diamond cell out of it, classified by a
 * {@link logicType} (a {@link TrianglePatternType.type} cross-ref).
 *
 * The record carries no explicit id field — the engine references a pattern by its position in the list,
 * so {@link id} is the 0-based index. The extractor keeps every record (skipping one would renumber the
 * rest), so the visual fields are optional rather than skip-on-missing and even a degenerate record still
 * occupies its slot. In the real data all 927 records are well-formed (name + texture + 6-int coords + a
 * `logicType` of 0..10).
 */
export const GfxPattern = z.strictObject({
  /** The 0-based position in the `GfxPattern` list — the engine's positional pattern id (no explicit field exists). */
  id: z.number().int().nonnegative(),
  /** `EditName` — the editor label (e.g. `"block desertStone 01 03 01"`). */
  editName: z.string().optional(),
  /** `EditGroups` — the editor grouping tags (e.g. `"meadow all"`, `"meadow green"`), kept verbatim; a record may list several. */
  editGroups: z.array(z.string()).default([]),
  /** `LogicType` — the {@link TrianglePatternType.type} this tile classifies as; {@link LOGIC_TYPE_NONE} for the misc/border tiles with no logic type. */
  logicType: TypeId.default(LOGIC_TYPE_NONE),
  /** `GfxTexture` — the normalized `data/.../text_NNN.pcx` ground-texture path (the pcx stage decodes it to a `text_NNN.png`). */
  texture: z.string().optional(),
  /** `GfxCoordsA` — the first triangle's 3 corner UVs into {@link texture}. */
  coordsA: GfxCoords.optional(),
  /** `GfxCoordsB` — the second triangle's 3 corner UVs into {@link texture}. */
  coordsB: GfxCoords.optional(),
  source: Provenance.optional(),
});
export type GfxPattern = z.infer<typeof GfxPattern>;

/**
 * One `[transition]` from `Data/engine2d/inis/patterntransitions/transitions.cif` — a ground transition
 * overlay (38 records): a translucent 256×256 texture blended over the base pattern where two ground
 * families meet. A record names an RGB texture and a separate alpha-mask picture
 * ({@link texture}/{@link textureAlpha} — the pipeline composes them into one RGBA page), plus six
 * `GfxCoordsA`/`GfxCoordsB` triangle-UV pairs (file order = the pair index a map lane's `value % 6`
 * selects; `⌊value / 6⌋` picks the record through the map's `eatd` name dictionary). The UV point
 * convention matches {@link GfxPattern}: `coordsA` = (TL, BR, BL), `coordsB` = (TL, TR, BR) of a
 * 64×64 tile square.
 */
export const GfxPatternTransition = z.strictObject({
  /** The 0-based position in the `transition` list (provenance; maps join by {@link editName}). */
  index: z.number().int().nonnegative(),
  /** `name` — the join key a decoded map's `transitions.types` dictionary entries reference. */
  editName: z.string().optional(),
  /** `pointtype` — the editor's transition-point class (e.g. `meadow`, `sand`); editor metadata. */
  pointType: z.string().optional(),
  /** `GfxTexture` — the normalized RGB `tran_*.pcx` path (decoded to a PNG by the pcx stage). */
  texture: z.string().optional(),
  /** `GfxTextureAlpha` — the normalized alpha-mask `tran_*_a.pcx` path (raw palette index = alpha). */
  textureAlpha: z.string().optional(),
  /** The six pair variants' first-triangle UVs, in file order (index = map lane `value % 6`). */
  coordsA: z.array(GfxCoords).default([]),
  /** The six pair variants' second-triangle UVs, in file order (parallel to {@link coordsA}). */
  coordsB: z.array(GfxCoords).default([]),
  source: Provenance.optional(),
});
export type GfxPatternTransition = z.infer<typeof GfxPatternTransition>;
