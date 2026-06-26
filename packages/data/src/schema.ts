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

/**
 * One input good consumed to produce this good, with its per-cycle quantity. From a `[goodtype]`'s
 * `productionInputGoods` line, where a repeated good id encodes the amount (`… 1 1 14 14 …` = 2×good1
 * + 2×good14), so the flat multiset is collapsed to `{ goodType, amount }` pairs in first-seen order.
 * This is the *input side* of the goods graph, keyed by the **output** good (the good being made).
 */
export const ProductionInput = z.object({
  goodType: TypeId,
  amount: z.number().int().positive(),
});
export type ProductionInput = z.infer<typeof ProductionInput>;

/**
 * The game's own classification of a good, from the boolean flags on each `[goodtype]` record. These
 * are the source-pinned node layers of the goods graph (the {@link ProductionInput} edges connect
 * them): a *raw* good is gathered from the map (`isProducedOnMapFlag`), a *produced* good is made in
 * a workplace (`isProducedInHouseFlag`, e.g. flour, bread, the two food tiers), and an *input* good
 * can be consumed by some recipe (`isInputGoodFlag`). A good may be several at once (a produced good
 * that is itself an input to another recipe); all default false when the flag is absent.
 */
export const GoodClassification = z.object({
  /** `isProducedOnMapFlag` — a raw good harvested/gathered from the map (wheat, stone, fruit, water). */
  producedOnMap: z.boolean().default(false),
  /** `isProducedInHouseFlag` — a good produced in a workplace (flour, bread, food_simple/food_extra). */
  producedInHouse: z.boolean().default(false),
  /** `isInputGoodFlag` — this good can be consumed as an input by some production recipe. */
  inputGood: z.boolean().default(false),
});
export type GoodClassification = z.infer<typeof GoodClassification>;

export const GoodType = z.object({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  atomics: GoodAtomics.default({}),
  /**
   * Input goods (+ per-cycle amounts) consumed to produce THIS good — the input side of the goods
   * graph, from `goodtypes` `productionInputGoods`. Empty for a raw/harvested good (no recipe). This
   * is the source the building `recipe` inputs are filled from (the workplace's `produces` output good
   * names the output; this good's `productionInputs` names what that cycle consumes). See ROADMAP Phase 3.
   */
  productionInputs: z.array(ProductionInput).default([]),
  /**
   * The good's node layer in the goods graph, from the `[goodtype]` boolean flags — distinguishes a
   * raw (map-gathered) good from a produced (in-house) one, and marks which goods are recipe inputs.
   * The {@link productionInputs} edges plus these layers are the explicit goods-graph IR. See
   * {@link GoodClassification} and ROADMAP Phase 3.
   */
  classification: GoodClassification.default({}),
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

/**
 * One `[humanjobexperiencetype]` record (`Data/logic/humanjobexperiencetypes.ini`) — a
 * per-specialization experience track. The original game grants a settler experience *within a
 * narrow specialization* (a `(job, good)` pairing, e.g. "collector wood" = job 8 + good 5), not just
 * per job: doing the same job on the same good repeatedly is what makes a settler an expert at it.
 * This table is the source of those tracks, the input the Phase-3 ProgressionSystem accrues XP into.
 *
 * A record names its owning `jobType` (`job`, always present) and, when the specialization is
 * good-specific, the `goodType` it trains on (`good`, present on 44 of 70 base records — a "general"
 * track like "builder general" omits it). `experienceFactor` (`experiencefactor`) scales how fast XP
 * accrues on this track; `baseRepeatCounter` (`baserepeatcounter`, on a few records) is the original's
 * repeat-count tuning for the track. Both numbers are captured raw — their exact runtime curve is the
 * ProgressionSystem's concern, pinned later; this is the data-extraction slice only (no XP logic yet).
 */
export const HumanJobExperienceType = z.object({
  /** The track's `type` id (unique within this table). */
  typeId: TypeId,
  /** Stable slug from `name` (e.g. "collector wood" -> `collector_wood`); `jobxp_<typeId>` if unnamed. */
  id: z.string(),
  name: z.string().optional(),
  /** The owning job (`job`) — always present; cross-checked against the job table at load. */
  jobType: TypeId,
  /** The specialization's good (`good`), when the track is good-specific; absent on "general" tracks. */
  goodType: TypeId.optional(),
  /** `experiencefactor` — how fast XP accrues on this track (raw; the curve is the ProgressionSystem's). */
  experienceFactor: z.number().int().nonnegative().default(0),
  /** `baserepeatcounter` — the original's repeat-count tuning for the track (raw), when present. */
  baseRepeatCounter: z.number().int().nonnegative().optional(),
  source: Provenance.optional(),
});
export type HumanJobExperienceType = z.infer<typeof HumanJobExperienceType>;

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
   * goods. The pipeline's `fillBuildingRecipes` joins each output good through that good's
   * `goodtypes.productionInputGoods` (→ {@link GoodType.productionInputs}) to materialize `recipe`.
   */
  produces: z.array(TypeId).default([]),
  /**
   * The production recipe, filled by the pipeline's output-side join (`fillBuildingRecipes`) for a
   * workplace with a non-empty `produces`; absent on a non-producing building. `inputs` come from the
   * produced good's `productionInputs`, `outputs` = each `produces` good at amount 1; `ticks` is the
   * schema default until the per-tribe atomic-timing pass pins it (docs/FIDELITY.md).
   */
  recipe: Recipe.optional(),
  /**
   * Build-material cost — the goods that must be delivered to *construct* this building, joined onto
   * the logic record from the graphics table's `[GfxHouse]` `LogicConstructionGoods` line (the readable
   * `DataCnmd/budynki12/houses/houses.ini`, keyed by the same `LogicType` id). The source line is a
   * flat good-id list where a **repeat encodes quantity** (`3 3 26` = 2× stone + pillar), collapsed to
   * `{goodType, amount}` pairs exactly like a recipe's inputs. Empty for the always-present
   * headquarters/wonder buildings (no construction cost) and for any type the graphics table omits.
   * For a home's level chain (`home level 00..04`) each level is a distinct `typeId` carrying its OWN
   * upgrade cost, so a leveled `home` building resolves the cost of *its* tier here (not cumulative).
   * The input data the future ConstructionSystem (place → deliver materials → build) consumes.
   */
  construction: z.array(z.object({ goodType: TypeId, amount: z.number().int().positive() })).default([]),
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
  /**
   * `goodtype` — the good that IS this weapon (the craftable item a settler wields), the weapon-side
   * twin of {@link ArmorType.goodType}; resolves into the good table. **Source `goodtype 0` is the
   * natural-weapon sentinel** (a fist/claw — no craftable good backs it) and is captured as
   * `undefined`, exactly as armor class 0 / weapon `damage["0"]` mean "unarmored" — good ids start at
   * 1, so a literal 0 would dangle. This is the join that ties a forged weapon-good back to its combat
   * stats (a smithy's `sword_short` good IS the short-sword weapon).
   */
  goodType: TypeId.optional(),
  source: Provenance.optional(),
});
export type WeaponType = z.infer<typeof WeaponType>;

export const ArmorType = z.object({
  /**
   * The armor's `type` id — the **armor class** a {@link WeaponType.damage} record keys against
   * (`damagevalue <armorClass> <value>`). Globally unique here (unlike {@link WeaponType.typeId}):
   * the readable `armortypes.ini` ships a flat 1..N table, not a per-tribe one. Armor class **0**
   * ("unarmored") has NO record — a weapon's `damage["0"]` is its damage against a bare target.
   */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** `mainType` — coarse class (1 = light/cloth+leather, 2 = heavy/chain+plate in the base data). */
  mainType: TypeId.optional(),
  /** `goodtype` — the good that IS this armor (worn/carried); resolves into the good table. */
  goodType: TypeId.optional(),
  /** `materialType` — the material tier the armor is made of (cloth/leather/chain/plate = 1..4). */
  materialType: TypeId.optional(),
  /** `weight` — encumbrance the armor adds (0 = leather, up to 3 = chain/plate). */
  weight: z.number().int().nonnegative().default(0),
  /** `blockingValue` — how much incoming damage the armor mitigates (the combat read side's join key). */
  blockingValue: z.number().int().nonnegative().default(0),
  source: Provenance.optional(),
});
export type ArmorType = z.infer<typeof ArmorType>;

/**
 * One `[animaltype]` record from the base `Data/logic/animaltypes.ini` — the per-tribe behaviour of a
 * non-controllable creature/monster tribe (bear, wolf, boar, cow, sheep, …). Unlike every other type
 * table, an animal record keys on **`tribetype`**, not `type`: the source carries no `type` id, and an
 * animal's identity IS its owning tribe (the `Settler.tribe` cross-reference into {@link TribeType}).
 * `tribeType` is therefore the cross-ref key (validated against the tribe table). A handful of source
 * records carry no `tribetype` (a leftover/disabled stub); they are dropped at extract time since they
 * cannot resolve to a tribe.
 *
 * Captured per record:
 *   - `aggressive` / `getangry` — whether the animal attacks unprovoked / can be provoked into anger
 *     (the inputs to the civ-vs-animal aggression model the later combat slice consumes).
 *   - `angryGameTime` — how long (game ticks) an angered animal stays hostile.
 *   - `hitpoints_adult` / `hitpoints_baby` — the HP pool by life-stage (200..20000; the param the sim's
 *     `Health`-component stamp already reads — humans have no readable equivalent below the `.ini`).
 *   - the group/territory params (`maximumgroupsize`, `maximumcadaversize`, `maximumleaderdistance`,
 *     `searchforleader`, `maximumdistancetostaypoint`, `maximumdistancetobirthpoint`) — herd/leader
 *     structure for the later spawn/herding slice.
 *   - `movespeed` / `runspeed` — locomotion (the run speed of a fleeing/charging animal).
 *   - the flags `catchable` (can be tamed/captured), `warrantable`, `cannotbeattacked`, `ignorehouses`.
 * The graphics/sound/spawn extras are skipped — this is the behaviour type-table slice, not a renderer.
 */
export const AnimalType = z.object({
  /** Slug of `name`/comment when present, else `animal_<tribeType>`. Not a cross-ref key — `tribeType` is. */
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`animaltype` `tribetype`) — the cross-ref into {@link TribeType}, and the record key. */
  tribeType: TypeId,
  /** `aggressive` — attacks civilizations unprovoked (the civ-vs-animal aggression driver). */
  aggressive: z.boolean().default(false),
  /** `getangry` — can be provoked into hostility (vs always-passive). */
  getAngry: z.boolean().default(false),
  /** `angryGameTime` — how long (game ticks) an angered animal stays hostile. */
  angryGameTime: z.number().int().nonnegative().default(0),
  /** `hitpoints_adult` — the adult HP pool (200..20000); the `Health`-stamp source for animal combatants. */
  hitpointsAdult: z.number().int().nonnegative().default(0),
  /** `hitpoints_baby` — the juvenile HP pool. Not inferred from `hitpointsAdult`; 0 when the source omits it. */
  hitpointsBaby: z.number().int().nonnegative().default(0),
  /** `maximumgroupsize` — how many of this animal form a herd/pack. */
  maximumGroupSize: z.number().int().nonnegative().default(0),
  /** `maximumcadaversize` — herd-corpse cap. */
  maximumCadaverSize: z.number().int().nonnegative().default(0),
  /** `maximumleaderdistance` — how far a member roams from its herd leader. */
  maximumLeaderDistance: z.number().int().nonnegative().default(0),
  /** `searchforleader` — whether a member seeks a leader to follow (herd animals) vs roams solo. */
  searchForLeader: z.boolean().default(false),
  /** `maximumdistancetostaypoint` — territory radius around the animal's stay point. */
  maximumDistanceToStayPoint: z.number().int().nonnegative().default(0),
  /** `maximumdistancetobirthpoint` — how far the herd ranges from its birth/spawn point. */
  maximumDistanceToBirthPoint: z.number().int().nonnegative().default(0),
  /** `movespeed` — walking speed (0 = the source default). */
  moveSpeed: z.number().int().nonnegative().default(0),
  /** `runspeed` — running speed (a fleeing/charging animal); 0 when the source omits it. */
  runSpeed: z.number().int().nonnegative().default(0),
  /** `catchable` — can be tamed/captured by a hunter (cows/sheep) vs wild-only. */
  catchable: z.boolean().default(false),
  /** `warrantable` — can be claimed/owned (livestock vs wildlife). */
  warrantable: z.boolean().default(false),
  /** `cannotbeattacked` — immune to civ attacks (bees/decorative fauna). */
  cannotBeAttacked: z.boolean().default(false),
  /** `ignorehouses` — pathing ignores buildings (it walks through/over them). */
  ignoreHouses: z.boolean().default(false),
  source: Provenance.optional(),
});
export type AnimalType = z.infer<typeof AnimalType>;

export const VehicleType = z.object({
  /** `vehicletype` `type` — the `logicvehicletype` namespace (1..N) the `jobEnablesVehicle` tech-graph
   *  edges and a `vehicle` building's `logicvehicletype` cross-reference into. */
  typeId: TypeId,
  /** Slug of `name`. Not unique — the real data ships two `oxcart` records (types 6 and 2) that slug
   *  alike; resolve a vehicle by `typeId` (the cross-ref key), not `id`, as with {@link WeaponType}. */
  id: z.string(),
  name: z.string().optional(),
  /**
   * `stockslots` — how many goods units the vehicle can haul at once: the carrier's carry capacity
   * (handcart 15, oxcart 30, ship small 50, ship big 200; the catapult carries 0). The sim's
   * `carrierCarryCapacity` (sim's `systems/progression.ts`) consumes this — a carrier hauls a batch up
   * to the largest `stockSlots` among its tribe's unlocked vehicles, not a single unit. Defaults 0 (no
   * record observed without it).
   */
  stockSlots: z.number().int().nonnegative().default(0),
  /** `passengerslots` — how many settlers can ride (ships carry 9/19; carts and the catapult carry 0). */
  passengerSlots: z.number().int().nonnegative().default(0),
  /** `logicsize` — the vehicle's footprint/size class (0 = land cart, 1 = catapult, 2 = ship). */
  logicSize: z.number().int().nonnegative().default(0),
  /**
   * `logicgood` allow-list — the `goodtype` ids this vehicle's hold may carry, in file order. A
   * repeated single-value key (one `logicgood N` per line). The carts and both ships enumerate the
   * full haulable-goods set; the catapult lists none (it carries no cargo). This is the "WHAT a
   * boat-as-mobile-store can hold" cargo filter the Sea/Northland slice consumes — distinct from
   * {@link stockSlots} (how *much* it holds). Empty when the section lists no `logicgood`.
   */
  cargoGoods: z.array(TypeId).default([]),
  source: Provenance.optional(),
});
export type VehicleType = z.infer<typeof VehicleType>;

export const LandscapeType = z.object({
  typeId: TypeId,
  id: z.string(),
  walkable: z.boolean().default(true),
  buildable: z.boolean().default(true),
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

/**
 * One tech-graph edge from `tribetypes` `jobEnables<Kind> <jobType> <targetId>` — having a settler
 * of `jobType` in the tribe *unlocks* a target the tribe can then produce/build/train/use. The four
 * source keys (`jobEnablesGood`/`jobEnablesHouse`/`jobEnablesJob`/`jobEnablesVehicle`) differ only in
 * what kind of id the target is, so they unify into one record discriminated by `kind`; the target
 * id is keyed within that kind's type table (a `good`→{@link GoodType}, `house`→{@link BuildingType},
 * `job`→{@link JobType}, `vehicle`→{@link VehicleType} via its `type`/`logicvehicletype` namespace,
 * which is distinct from the building namespace).
 *
 * This is the *gate* half of the progression graph — the original keys availability of goods/houses/
 * jobs/vehicles on a job being present, which is in turn gated by training/experience (`trainforjob`/
 * `needfor*`, a later slice). Edges are kept in **exact source file order** (the data interleaves the
 * four kinds within a job's block, not grouped by kind); a tribe may repeat a `(jobType, kind,
 * targetId)` triple, kept verbatim like {@link AtomicBinding} (the raw source stays faithful).
 */
export const JobEnablesKind = z.enum(['good', 'house', 'job', 'vehicle']);
export type JobEnablesKind = z.infer<typeof JobEnablesKind>;

export const JobEnables = z.object({
  /** The job whose presence unlocks the target (`jobEnables*`'s first int). */
  jobType: TypeId,
  /** Which type table `targetId` indexes (from the `jobEnables<Kind>` key). */
  kind: JobEnablesKind,
  /** The unlocked target id, keyed within `kind`'s type table (the second int). */
  targetId: TypeId,
});
export type JobEnables = z.infer<typeof JobEnables>;

/**
 * One experience requirement from `tribetypes` `{need,train}for{job,good} <targetId> <amount>
 * <expType> [expType2]` — the *experience-threshold* half of progression, sitting under the
 * {@link JobEnables} *who-unlocks-it* gate. Two orthogonal dimensions:
 *
 * - `requirement`: `need` (`needfor*` — the XP the settler must already have accrued to unlock the
 *   target) vs `train` (`trainfor*` — the schooling time/XP to acquire it at a training house, paid
 *   in a synthetic "school" experience type, not a real work track).
 * - `target`: `job` (`*forjob` — the unlocked job id) vs `good` (`*forgood` — the unlocked good id).
 *
 * `experienceTypes` mostly name `humanjobexperiencetypes` `typeId`s, but they span an id space
 * **wider than that 70-entry table** — `need` lines reach 72/73/75 and `train` lines pay in
 * synthetic "school" markers (observed 57/77) — none of which are in the experience table. So they
 * are captured but deliberately **not** cross-validated (validating them would false-positive —
 * unlike the `vehicle` {@link JobEnables} kind, which DOES resolve now the `vehicletypes` table is
 * extracted). A line carries one or two expTypes (the optional second is rare); kept in source order.
 */
export const JobRequirementKind = z.enum(['need', 'train']);
export type JobRequirementKind = z.infer<typeof JobRequirementKind>;
export const JobRequirementTarget = z.enum(['job', 'good']);
export type JobRequirementTarget = z.infer<typeof JobRequirementTarget>;

export const JobRequirement = z.object({
  /** `need` (XP already accrued) vs `train` (schooling), from the `need`/`train` key prefix. */
  requirement: JobRequirementKind,
  /** `job` vs `good`, from the `forjob`/`forgood` key suffix — which table `targetId` indexes. */
  target: JobRequirementTarget,
  /** The unlocked target id, keyed within `target`'s type table (the first int). */
  targetId: TypeId,
  /** The experience amount required (the second int). */
  amount: z.number().int().nonnegative(),
  /** The experience-type id(s) the amount is measured in (one or two; the third/fourth ints). */
  experienceTypes: z.array(TypeId).default([]),
});
export type JobRequirement = z.infer<typeof JobRequirement>;

export const TribeType = z.object({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** `setatomic` bindings in file order — a tribe's atomic→animation vocabulary, per job. */
  atomicBindings: z.array(AtomicBinding).default([]),
  /** `jobEnables*` tech-graph edges in file order — what each job unlocks for the tribe. */
  jobEnables: z.array(JobEnables).default([]),
  /** `{need,train}for{job,good}` XP/schooling requirements in file order — the gate's threshold half. */
  jobRequirements: z.array(JobRequirement).default([]),
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

/**
 * A decoded terrain grid file (`content/maps/<id>.json`) — the per-map nav-graph input the pipeline
 * emits from `map.dat` (the `lmlt` 4-corner landscape lane reduced to one typeId per cell, `+1`-shifted
 * onto the 1-based IR {@link LandscapeType} typeId). This is the on-disk twin of the sim's `TerrainMap`
 * (the sim defines that structural type without zod; this schema is the validating loader boundary so
 * the build tool / app can `parseTerrainMap` a file before it ever reaches the pure sim). The
 * `typeIds.length === width * height` invariant is enforced here so a truncated/oversized grid fails
 * at load, not as a confusing out-of-bounds read inside `buildTerrainGraph`.
 */
export const TerrainMapFile = z
  .object({
    /** Map width in cells. */
    width: z.number().int().positive(),
    /** Map height in cells. */
    height: z.number().int().positive(),
    /** Row-major landscape typeId per cell (length must equal width*height). */
    typeIds: z.array(TypeId),
  })
  .refine(
    (m) => m.typeIds.length === m.width * m.height,
    (m) => ({
      message: `terrain map typeIds length ${m.typeIds.length} != width*height (${m.width}*${m.height} = ${
        m.width * m.height
      })`,
      path: ['typeIds'],
    }),
  );
export type TerrainMapFile = z.infer<typeof TerrainMapFile>;

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
  jobExperience: z.array(HumanJobExperienceType).default([]),
  buildings: z.array(BuildingType),
  weapons: z.array(WeaponType).default([]),
  armor: z.array(ArmorType).default([]),
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
