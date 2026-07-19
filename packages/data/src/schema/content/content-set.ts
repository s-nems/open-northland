import { z } from 'zod';
import { AnimalType } from '../actors/animals.js';
import { ArmorType, WeaponType } from '../actors/equipment.js';
import { AtomicAnimation, TribeType } from '../actors/tribes.js';
import { VehicleType } from '../actors/vehicles.js';
import { SoundBank } from '../audio/sound.js';
import { BuildingType } from '../economy/buildings.js';
import { GoodType } from '../economy/goods.js';
import { HumanJobExperienceType, JobType } from '../economy/jobs.js';
import { GfxAnimAtomic } from '../graphics/atomic-anims.js';
import { BobSequenceSet } from '../graphics/bob-sequences.js';
import { BuildingBob, BuildingConstructionLayer, BuildingOverlay } from '../graphics/building-bobs.js';
import { GfxWalkAtomic } from '../graphics/walk-anims.js';
import { GatheringPipeline, LandscapeGfx, LandscapeType } from '../landscape/objects.js';
import {
  GfxPattern,
  GfxPatternTransition,
  TerrainPattern,
  TrianglePatternType,
} from '../landscape/terrain.js';
import { MapInfo } from '../maps/info.js';

/** Top-level manifest written to content/ir.json. */
export const IrManifest = z.strictObject({
  version: z.number().int().positive(),
  generatedFrom: z.strictObject({
    game: z.string(),
    mod: z.string().optional(),
  }),
  locale: z.enum(['pol', 'eng', 'ger', 'rus']).default('eng'),
});
export type IrManifest = z.infer<typeof IrManifest>;

/** A fully-loaded, validated content set ready for the sim. */
export const ContentSet = z.strictObject({
  manifest: IrManifest,
  goods: z.array(GoodType),
  jobs: z.array(JobType),
  jobExperience: z.array(HumanJobExperienceType).default([]),
  buildings: z.array(BuildingType),
  weapons: z.array(WeaponType).default([]),
  armor: z.array(ArmorType).default([]),
  animals: z.array(AnimalType).default([]),
  vehicles: z.array(VehicleType).default([]),
  landscape: z.array(LandscapeType).default([]),
  landscapeGfx: z.array(LandscapeGfx).default([]),
  /** Resolved per-good gathering pipelines (good→landscape→gfx join), one per map-gathered good. */
  gatheringPipeline: z.array(GatheringPipeline).default([]),
  gfxPatterns: z.array(GfxPattern).default([]),
  /** The `[transition]` overlay table (`transitions.cif`) a decoded map's `transitions.types`
   *  names join onto — the texture + six UV pairs per record (render-binding data). */
  gfxPatternTransitions: z.array(GfxPatternTransition).default([]),
  terrainPatterns: z.array(TerrainPattern).default([]),
  /** The per-logicType ground classes (`trianglepatterntypes.cif`) a {@link GfxPattern.logicType}
   *  references — the walk/build/water flags the map-collision join classes real ground by. */
  trianglePatternTypes: z.array(TrianglePatternType).default([]),
  bobSequences: z.array(BobSequenceSet).default([]),
  /** `[gfxanimatomic]` atomic-action → directional body-animation bindings (render-binding data). */
  gfxAtomics: z.array(GfxAnimAtomic).default([]),
  /** `[gfxwalkatomic]` good → loaded-gait bindings — the original's own carry-look table. */
  gfxWalkAtomics: z.array(GfxWalkAtomic).default([]),
  buildingBobs: z.array(BuildingBob).default([]),
  constructionLayers: z.array(BuildingConstructionLayer).default([]),
  /** `[GfxHouse]` `GfxOverlay` type-4 animated state overlays (the mill rotor — render-binding data). */
  buildingOverlays: z.array(BuildingOverlay).default([]),
  tribes: z.array(TribeType).default([]),
  atomicAnimations: z.array(AtomicAnimation).default([]),
  maps: z.array(MapInfo).default([]),
  /** Decoded `soundfx.cif` sound bank (render-binding data; the pure sim ignores it). */
  sounds: SoundBank.default({ staticGroups: [], ambient: [], jingles: [] }),
});
export type ContentSet = z.infer<typeof ContentSet>;

/** Current IR schema version. Bump on breaking schema changes; sim checks the major. */
export const IR_VERSION = 1 as const;
