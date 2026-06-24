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

/**
 * Atomic ids are a numeric vocabulary cross-referenced by goods (`atomicFor*`), jobs
 * (`allowatomic`/`baseatomics`) and tribes (`setatomic`). The readable data ships NO master
 * atomictypes table — an atomic id's meaning is implicit in how those sources reference it
 * (e.g. the id under `atomicForHarvesting` is the harvest atomic for that good). The Phase-2
 * atomic planner consumes these bindings. See docs/ECS.md "Settler AI" and docs/ROADMAP.md Phase 1.
 */
export const AtomicId = z.number().int().nonnegative();

/**
 * Atomic ids that act on a good, keyed by role (from `goodtypes` `atomicFor*`). A good is the
 * *object* of the atomic: `harvest` cuts/mines/reaps it, `plant`/`cultivate` grow it, `produce`
 * is the atomic a workplace runs to make it.
 */
export const GoodAtomics = z.object({
  harvest: AtomicId.optional(),
  cultivate: AtomicId.optional(),
  plant: AtomicId.optional(),
  produce: AtomicId.optional(),
});
export type GoodAtomics = z.infer<typeof GoodAtomics>;

export const GoodType = z.object({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  atomics: GoodAtomics.default({}),
  source: Provenance.optional(),
});
export type GoodType = z.infer<typeof GoodType>;

export const JobType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Atomic ids this job is permitted to perform (`jobtypes` `allowatomic`), in file order. */
  allowedAtomics: z.array(AtomicId).default([]),
  /** Always-available base atomics for this job (`jobtypes` `baseatomics`), in file order. */
  baseAtomics: z.array(AtomicId).default([]),
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

/**
 * Per-(job, atomic) animation binding from `tribetypes` `setatomic <jobType> <atomicId> "anim"`.
 * This is how a tribe expresses its identity: the SAME atomic id plays a tribe-specific animation.
 * `animation` names an entry in `atomicanimations` (timings/yields extracted in a later step).
 */
export const AtomicBinding = z.object({
  jobType: TypeId,
  atomicId: AtomicId,
  animation: z.string(),
});
export type AtomicBinding = z.infer<typeof AtomicBinding>;

export const TribeType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** `setatomic` bindings in file order — a tribe's atomic→animation vocabulary, per job. */
  atomicBindings: z.array(AtomicBinding).default([]),
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
