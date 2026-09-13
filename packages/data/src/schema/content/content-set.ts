import { z } from 'zod';
import { AnimalType } from '../actors/animals.js';
import { ArmorType, WeaponType } from '../actors/equipment.js';
import { HuntPrey } from '../actors/hunting.js';
import { AtomicAnimation, TribeType } from '../actors/tribes.js';
import { VehicleType } from '../actors/vehicles.js';
import { SoundBank } from '../audio/sound.js';
import { BuildingType } from '../economy/buildings.js';
import { GoodType } from '../economy/goods.js';
import { HumanJobExperienceType, JobType } from '../economy/jobs.js';
import { GfxAnimAtomic } from '../graphics/atomic-anims.js';
import { BobSequenceSet } from '../graphics/bob-sequences.js';
import {
  BuildingBob,
  BuildingConstructionLayer,
  BuildingFlagPoint,
  BuildingOverlay,
} from '../graphics/building-bobs.js';
import { GfxInHouseProgram } from '../graphics/inhouse-anims.js';
import { JobGraphics } from '../graphics/job-graphics.js';
import { GfxWalkAtomic } from '../graphics/walk-anims.js';
import { LandscapeGfx, LandscapeType } from '../landscape/objects.js';
import { GatheringPipeline, TerrainPattern } from '../landscape/resolved.js';
import { GfxPattern, GfxPatternTransition, TrianglePatternType } from '../landscape/terrain.js';
import { MapInfo } from '../maps/info.js';
import { IR_VERSION, NO_PIPELINE_REVISION } from './ir-version.js';

// The two version constants live on the schema-free `./ir-version` subpath, so a shell that only
// stamps or compares content does not pull the zod graph in.
export { IR_VERSION, NO_PIPELINE_REVISION };

/** Top-level manifest written to content/ir.json. */
export const IrManifest = z.strictObject({
  version: z.literal(IR_VERSION, {
    error: (issue) =>
      `IR version mismatch: content reports ${String(issue.input)}, this build reads ${IR_VERSION}.`,
  }),
  /** The pipeline's conversion revision, part of a save file's content identity. */
  contentRevision: z.number().int().nonnegative().default(NO_PIPELINE_REVISION),
  modVersion: z.string().trim().min(1).max(128).optional(),
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
  /** Authored prey/yield table, joined onto `animals` by `tribeType`. */
  huntPrey: z.array(HuntPrey).default([]),
  vehicles: z.array(VehicleType).default([]),
  landscape: z.array(LandscapeType).default([]),
  landscapeGfx: z.array(LandscapeGfx).default([]),
  /** The resolved good→landscape→gfx join, one record per map-gathered good. */
  gatheringPipeline: z.array(GatheringPipeline).default([]),
  gfxPatterns: z.array(GfxPattern).default([]),
  /** The `[transition]` overlay table (`transitions.cif`) a decoded map's `transitions.types` names
   *  join onto: the texture and six UV pairs per record. */
  gfxPatternTransitions: z.array(GfxPatternTransition).default([]),
  terrainPatterns: z.array(TerrainPattern).default([]),
  /** The per-logicType ground classes (`trianglepatterntypes.cif`): the walk/build/water flags the
   *  map-collision join classes real ground by. */
  trianglePatternTypes: z.array(TrianglePatternType).default([]),
  bobSequences: z.array(BobSequenceSet).default([]),
  /** `[jobbasegraphics]` `(tribe, job)` → body/head bob-set bindings. */
  jobGraphics: z.array(JobGraphics).default([]),
  /** `[gfxanimatomic]` atomic-action → directional body-animation bindings. */
  gfxAtomics: z.array(GfxAnimAtomic).default([]),
  /** `[gfxwalkatomic]` good → loaded-gait bindings. */
  gfxWalkAtomics: z.array(GfxWalkAtomic).default([]),
  /** `[gfxanimatomic]` `gfxanimmode 2` records: the indoor choreography per `(tribe, job, action)`. */
  gfxInHousePrograms: z.array(GfxInHouseProgram).default([]),
  buildingBobs: z.array(BuildingBob).default([]),
  constructionLayers: z.array(BuildingConstructionLayer).default([]),
  /** `[GfxHouse]` `GfxOverlay` type-4 animated state overlays, such as the mill rotor. */
  buildingOverlays: z.array(BuildingOverlay).default([]),
  /** `[GfxHouse]` `GfxFlagPoint` anchors: where a building's sign chain plants. */
  buildingFlagPoints: z.array(BuildingFlagPoint).default([]),
  /** `[GfxHouse]` `gfxsoldierflagpoint` anchors: where a manned post flies its garrison flag. */
  buildingSoldierFlagPoints: z.array(BuildingFlagPoint).default([]),
  tribes: z.array(TribeType).default([]),
  atomicAnimations: z.array(AtomicAnimation).default([]),
  maps: z.array(MapInfo).default([]),
  /** Decoded `soundfx.cif` sound bank; the pure sim ignores it. */
  sounds: SoundBank.default({ staticGroups: [], ambient: [], jingles: [] }),
});
export type ContentSet = z.infer<typeof ContentSet>;
