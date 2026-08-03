import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';
import { GfxCoords, RgbColor } from './terrain.js';

/**
 * One stage of a resolved {@link GatheringPipeline}: a {@link LandscapeType} id plus the
 * {@link LandscapeGfx} records that place it. Empty when the stage is pure logic with no placeable
 * object.
 */
export const GatheringStage = z.strictObject({
  /** The stage's {@link LandscapeType.typeId} (`landscapeToHarvest`/`Pickup`/`Store`). */
  landscapeType: TypeId,
  /** {@link LandscapeGfx.index} values whose `logicType` == {@link landscapeType}. */
  gfxIndices: z.array(z.number().int().nonnegative()).default([]),
});
export type GatheringStage = z.infer<typeof GatheringStage>;

/**
 * The good→landscape→gfx join materialized once at build time, one record per map-gathered good;
 * produced and in-house goods have none. A stage is absent when the source good omits that lane.
 */
export const GatheringPipeline = z.strictObject({
  /** The good this pipeline yields ({@link GoodType.typeId}). */
  goodType: TypeId,
  /** The good's slug, for legibility. */
  goodId: z.string(),
  /** `atomicForHarvesting` - the atomic action a settler runs to work the {@link harvest} stage. */
  harvestAtomic: AtomicId.optional(),
  /** `isBioLandscapeFlag` - living/growing (trees, herb) rather than mined (stone, ore). */
  bioLandscape: z.boolean().default(false),
  /** Stage 1 - the source object a settler harvests (a `tree`/`rock`/`mine`). */
  harvest: GatheringStage.optional(),
  /** Stage 2 - the pick-up intermediate (a `trunk`/`ore`). */
  pickup: GatheringStage.optional(),
  /** Stage 3 - the finished good resting on the ground until stocked. */
  store: GatheringStage.optional(),
});
export type GatheringPipeline = z.infer<typeof GatheringPipeline>;

/**
 * The approximated per-landscape-typeId ground binding the terrain renderer consumes. A map cell's
 * `lmlt` value is a {@link LandscapeType.typeId}, but those types are mostly objects (tree, rock,
 * wheat), not ground classes, so each typeId's ground is approximated from its `id` slug into a coarse
 * family and bound to one representative {@link GfxPattern}. A named deviation: the original computes
 * the per-cell pattern from corner types and variant lanes, an oracle-blocked algorithm.
 */
export const TerrainPattern = z.strictObject({
  /** The {@link LandscapeType.typeId} (1-based) this ground binding applies to - the per-cell value in `content/maps`. */
  typeId: TypeId,
  /** The coarse ground family the typeId's name classified into (the approximation axis). */
  family: z.enum(['water', 'mountain', 'land']),
  /** The chosen representative {@link GfxPattern.id}. */
  patternId: z.number().int().nonnegative(),
  /** The representative's {@link TrianglePatternType.type} (water=1, land=2, mountain=3). */
  logicType: TypeId,
  /** The ground texture path the renderer samples (`text_NNN.pcx`, decoded to a PNG). */
  texture: z.string(),
  /** The first triangle's 3 corner UVs into {@link texture}. */
  coordsA: GfxCoords,
  /** The second triangle's 3 corner UVs into {@link texture}. */
  coordsB: GfxCoords,
  /** The logic type's `debugColor` - the flat-tint fallback when the texture cannot be loaded. */
  debugColor: RgbColor.optional(),
  source: Provenance.optional(),
});
export type TerrainPattern = z.infer<typeof TerrainPattern>;
