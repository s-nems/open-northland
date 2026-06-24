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
  /** Atomic ids explicitly denied to this job (`jobtypes` `forbidatomic`) — an override that the
   *  planner must treat as a hard exclusion, distinct from merely "not in allowedAtomics". */
  forbiddenAtomics: z.array(AtomicId).default([]),
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
  /**
   * Coarse building class, mapped from the original `logichousetype` `logicmaintype`:
   * `storage` (HQ + stocks), `home` (residences), `workplace` (production), `training`
   * (barracks/school), `tower` (defence), `vehicle` (buildable carts/ships), `wonder`.
   * The specific building (headquarters vs a stock, which workplace) is carried by `id`.
   */
  kind: z.string(),
  /** Population capacity tier from `logichomesize` — present only on `home` buildings (else 0). */
  homeSize: z.number().int().nonnegative().default(0),
  workers: z.array(WorkerSlot).default([]),
  stock: z.array(StockSlot).default([]),
  /**
   * Good type ids this workplace can produce (`logichousetype` `logicproduction`), in file order.
   * The *output side only*: the original house table names what a workplace makes, not the input
   * goods or per-cycle amounts/timing — those come from `goodtypes.productionInputGoods` when the
   * full goods graph is materialized (docs/ROADMAP.md Phase 3), at which point `recipe` is filled.
   */
  produces: z.array(TypeId).default([]),
  recipe: Recipe.optional(),
  source: Provenance.optional(),
});
export type BuildingType = z.infer<typeof BuildingType>;

export const WeaponType = z.object({
  /** The weapon's `type` id. NOTE: unlike the other type tables this is NOT globally unique — a
   *  weapon is keyed by `(tribeType, typeId)` in the original `weapontypes`, so the same `typeId`
   *  (e.g. 2 = "fist") recurs once per tribe. Resolve a weapon with both ids, not `typeId` alone. */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`weapontype` `tribetype`). Part of the composite key — see `typeId`. */
  tribeType: TypeId.optional(),
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
 * `animation` names an entry in `atomicanimations` — see {@link AtomicAnimation} for its
 * timing/effect data (the binding string is the join key onto `AtomicAnimation.name`).
 *
 * Bindings are kept in file order. The real data repeats some `(jobType, atomicId)` pairs within one
 * tribe (e.g. ship atomics); consumers resolve a lookup as **last-wins** (a later line overrides an
 * earlier one), matching the original engine's config-override semantics. The extractor keeps every
 * line rather than pre-deduping, so the raw source stays faithfully represented.
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

/**
 * One timed event inside an atomic animation (`event`/`eventx <at> <type> [value]` in
 * `atomicanimations.ini`). `at` is the offset within the animation's `length`; `type` + `value`
 * form an undocumented numeric vocabulary (good yields, hunger/morale deltas, sound/effect cues) —
 * captured faithfully here and interpreted later by the Phase-2 AtomicSystem, mirroring how
 * {@link AtomicId} stays a raw id with no master table. `value` is optional and may be signed.
 * `extended` marks the `eventx` variant (a distinct event channel in the source) from plain `event`.
 */
export const AtomicEvent = z.object({
  at: z.number().int().nonnegative(),
  type: z.number().int().nonnegative(),
  value: z.number().int().optional(),
  extended: z.boolean().default(false),
});
export type AtomicEvent = z.infer<typeof AtomicEvent>;

/**
 * Timing + effect data for one named animation from `atomicanimations.ini` (the `culturesnation` mod
 * ships a readable `.ini`; the base game has it as `.cif`). `name` is the join key — a tribe's
 * `setatomic <job> <atomic> "anim"` binding ({@link AtomicBinding}) names the animation here, so this
 * is where an atomic's *duration* (`length`, in animation ticks), facing (`startdirection`) and timed
 * `events` (yields/effects) live. Cross-referencing tribe bindings against these names is deferred:
 * the mod's readable set is a subset of the base-game animations, so absent names aren't dangling.
 */
export const AtomicAnimation = z.object({
  /** Filesystem-safe slug of `name`, for legibility/parity with the other IR types. Display-only —
   *  it lowercases, so it is NOT the join key; resolve `setatomic` bindings against `name`, not `id`. */
  id: z.string(),
  /** The animation's exact name — the resolvable key referenced by `tribetypes` `setatomic`. */
  name: z.string(),
  /** Duration in animation ticks (`length`). */
  length: z.number().int().nonnegative().default(0),
  /** Whether the animation may be interrupted mid-play (`interruptable 1` in the source). */
  interruptible: z.boolean().default(false),
  /** Initial facing-direction index (`startdirection`), when the animation pins one. */
  startDirection: z.number().int().nonnegative().optional(),
  /** Timed events in file order (`event`/`eventx` lines). */
  events: z.array(AtomicEvent).default([]),
  source: Provenance.optional(),
});
export type AtomicAnimation = z.infer<typeof AtomicAnimation>;

/**
 * The decoded logic header of one `map.cif` — the readable, declarative scalars at the top of a map's
 * `CStringArray` (`logiccontrol` + the `misc_*` sections). This is **not** the playable terrain: the
 * binary tile/landscape grid (if stored outside this header) is a Phase-2 cell-graph concern. What is
 * captured here is the map's identity and metadata, which every map carries consistently:
 * dimensions, a stable GUID, its type/campaign slot, and the string-table ids of its name/description.
 *
 * The map's scripting payload — `MissionData` goals/results, `StaticObjects` pre-placed houses/goods,
 * `playerdata`/`AIData` — is deliberately **not** extracted here: it is the campaign/trigger layer
 * (docs/ROADMAP.md Phase 5), a far larger vocabulary than this metadata slice. See docs/SOURCES.md.
 */
export const MapInfo = z.object({
  /** Stable slug id (from the map folder name, lower-cased) — the cross-reference key. */
  id: z.string(),
  /** Map width in cells (`logiccontrol` `mapsize <w> <h>`, first value). */
  width: z.number().int().positive(),
  /** Map height in cells (`logiccontrol` `mapsize <w> <h>`, second value). */
  height: z.number().int().positive(),
  /** The 16-byte map GUID (`logiccontrol` `mapguid`), as raw bytes 0..255 in file order. */
  guid: z.array(z.number().int().min(0).max(255)).length(16),
  /** Map kind (`misc_maptype` `maptype`): observed 1 = single-player/campaign, 4 = skirmish/multiplayer. */
  mapType: z.number().int().nonnegative().optional(),
  /** Campaign + mission slot (`misc_maptype` `mapcampaignid <campaign> <mission>`), present only on campaign maps. */
  campaign: z.object({ campaignId: z.number().int(), missionId: z.number().int() }).optional(),
  /** String-table id of the map's display name (`misc_mapname` `mapnamestringid`) — resolved against the locale strings, a later step. */
  nameStringId: z.number().int().optional(),
  /** String-table id of the map's description (`misc_mapname` `mapdescriptionstringid`). */
  descriptionStringId: z.number().int().optional(),
  source: Provenance.optional(),
});
export type MapInfo = z.infer<typeof MapInfo>;

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
  atomicAnimations: z.array(AtomicAnimation).default([]),
  maps: z.array(MapInfo).default([]),
});
export type ContentSet = z.infer<typeof ContentSet>;

/** Current IR schema version. Bump on breaking schema changes; sim checks the major. */
export const IR_VERSION = 1 as const;
