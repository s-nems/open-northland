import { z } from 'zod';

/**
 * Intermediate-representation (IR) schemas — the single source of truth for the content model.
 * These produce BOTH runtime validation and inferred TS types. The sim and render packages
 * consume the inferred types; the asset pipeline produces JSON validated against these schemas.
 *
 * See docs/DATA-FORMAT.md for how these map onto the original .ini/.cif fields.
 *
 * NOTE: this is the Phase-1 starting shape. Fields will grow as decoders are written. Keep every
 * cross-reference id resolvable (see validateContentSet) so dangling references fail at load time.
 */

/** Where an IR record came from in the original data — kept for auditability. */
export const Provenance = z.object({
  file: z.string(),
  block: z.string().optional(),
  layer: z.enum(['base', 'mod']).default('base'),
});
export type Provenance = z.infer<typeof Provenance>;

/** Numeric type ids are the stable cross-reference used throughout the original data. */
export const TypeId = z.number().int().nonnegative();

export const GoodType = z.object({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  source: Provenance.optional(),
});
export type GoodType = z.infer<typeof GoodType>;

export const JobType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  source: Provenance.optional(),
});
export type JobType = z.infer<typeof JobType>;

export const StockSlot = z.object({
  goodType: TypeId,
  capacity: z.number().int().nonnegative(),
  initial: z.number().int().nonnegative().default(0),
});
export type StockSlot = z.infer<typeof StockSlot>;

export const WorkerSlot = z.object({
  jobType: TypeId,
  count: z.number().int().nonnegative(),
});
export type WorkerSlot = z.infer<typeof WorkerSlot>;

/** A recipe: a workplace turns inputs into outputs over time. */
export const Recipe = z.object({
  inputs: z.array(z.object({ goodType: TypeId, amount: z.number().int().positive() })).default([]),
  outputs: z.array(z.object({ goodType: TypeId, amount: z.number().int().positive() })).default([]),
  /** Game ticks to complete one production cycle. */
  ticks: z.number().int().positive().default(20),
});
export type Recipe = z.infer<typeof Recipe>;

export const BuildingType = z.object({
  typeId: TypeId,
  id: z.string(), // e.g. "headquarters"
  kind: z.string(), // "house" | "workplace" | "headquarters" | ...
  workers: z.array(WorkerSlot).default([]),
  stock: z.array(StockSlot).default([]),
  recipe: Recipe.optional(),
  source: Provenance.optional(),
});
export type BuildingType = z.infer<typeof BuildingType>;

export const WeaponType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  minRange: z.number().int().nonnegative().default(1),
  maxRange: z.number().int().nonnegative().default(1),
  /** damageValue[targetArmorClass] -> value, as in the original weapontypes. */
  damage: z.record(z.string(), z.number()).default({}),
  jobType: TypeId.optional(),
  source: Provenance.optional(),
});
export type WeaponType = z.infer<typeof WeaponType>;

export const AnimalType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  source: Provenance.optional(),
});
export type AnimalType = z.infer<typeof AnimalType>;

export const VehicleType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;

export const LandscapeType = z.object({
  typeId: TypeId,
  id: z.string(),
  walkable: z.boolean().default(true),
  buildable: z.boolean().default(true),
  source: Provenance.optional(),
});
export type LandscapeType = z.infer<typeof LandscapeType>;

export const TribeType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  source: Provenance.optional(),
});
export type TribeType = z.infer<typeof TribeType>;

/** Top-level manifest written to content/ir.json. */
export const IrManifest = z.object({
  version: z.number().int().positive(),
  generatedFrom: z.object({
    game: z.string(),
    mod: z.string().optional(),
  }),
  locale: z.enum(['pol', 'eng', 'ger', 'rus']).default('eng'),
});
export type IrManifest = z.infer<typeof IrManifest>;

/** A fully-loaded, validated content set ready for the sim. */
export const ContentSet = z.object({
  manifest: IrManifest,
  goods: z.array(GoodType),
  jobs: z.array(JobType),
  buildings: z.array(BuildingType),
  weapons: z.array(WeaponType).default([]),
  animals: z.array(AnimalType).default([]),
  vehicles: z.array(VehicleType).default([]),
  landscape: z.array(LandscapeType).default([]),
  tribes: z.array(TribeType).default([]),
});
export type ContentSet = z.infer<typeof ContentSet>;

/** Current IR schema version. Bump on breaking schema changes; sim checks the major. */
export const IR_VERSION = 1 as const;
