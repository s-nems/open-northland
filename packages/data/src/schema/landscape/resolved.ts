import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';
import { GfxCoords, RgbColor } from './terrain.js';

/**
 * One stage of a resolved {@link GatheringPipeline}: a {@link LandscapeType} id plus the
 * {@link LandscapeGfx} records that place it. Empty when no gfx record carries that logic type (a
 * pure-logic landscape stage with no placeable object).
 */
export const GatheringStage = z.strictObject({
  /** The stage's {@link LandscapeType.typeId} (`landscapeToHarvest`/`Pickup`/`Store`). */
  landscapeType: TypeId,
  /** {@link LandscapeGfx.index} values whose `logicType` == {@link landscapeType} (the placeable gfx for this stage). */
  gfxIndices: z.array(z.number().int().nonnegative()).default([]),
});
export type GatheringStage = z.infer<typeof GatheringStage>;

/**
 * The resolved gathering pipeline for one raw good — the good→landscape→gfx join materialized once at
 * build time from {@link GoodType.gathering} + the {@link LandscapeType} + {@link LandscapeGfx} tables.
 * One record per map-gathered good; produced/in-house goods have none. A stage is absent when the
 * source good omits that lane (honey has no {@link harvest}).
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

/**
 * The approximated per-landscape-typeId ground binding — the typeId→pattern map the terrain renderer
 * consumes. Every map cell carries a {@link LandscapeType.typeId} (1-based, the `lmlt` per-cell value),
 * but those types are mostly objects (void/tree/rock/iron/wheat…), not ground classes. This table
 * approximates each typeId's ground by a coarse family — its `id` slug naming water → `water`,
 * `rock`/`stone` → `mountain`, everything else (incl. tree/bush/wood, whose ground is land) → `land` —
 * and binds the family to one representative {@link GfxPattern} (its `text_NNN` texture + the two
 * triangles' UVs). A deviation, not a 1:1 match (source basis): the original computes the per-cell
 * pattern from corner types + variant lanes, an oracle-blocked algorithm.
 */
export const TerrainPattern = z.strictObject({
  /** The {@link LandscapeType.typeId} (1-based) this ground binding applies to — the per-cell value in `content/maps`. */
  typeId: TypeId,
  /** The coarse ground family the typeId's name classified into (the approximation axis). */
  family: z.enum(['water', 'mountain', 'land']),
  /** The chosen representative {@link GfxPattern.id} (provenance for the pick — a positional pattern id). */
  patternId: z.number().int().nonnegative(),
  /** The representative's {@link TrianglePatternType.type} (water=1 / land=2 / mountain=3). */
  logicType: TypeId,
  /** The ground texture path (`data/.../text_NNN.pcx`) the renderer samples (decoded to a `text_NNN.png`). */
  texture: z.string(),
  /** The first triangle's 3 corner UVs into {@link texture}. */
  coordsA: GfxCoords,
  /** The second triangle's 3 corner UVs into {@link texture}. */
  coordsB: GfxCoords,
  /** The logic-type `debugColor` (RGB) — the flat-tint fallback when the texture can't be loaded. */
  debugColor: RgbColor.optional(),
  source: Provenance.optional(),
});
export type TerrainPattern = z.infer<typeof TerrainPattern>;
