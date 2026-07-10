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
 *
 * Every object schema is STRICT (`z.strictObject`) — an unknown key is an ERROR, never silently
 * stripped. A key the schema doesn't know is either a typo in hand-edited content (which zod's
 * default strip mode would swallow, silently losing the edit) or an extractor emitting a field the
 * schema hasn't modeled yet (which must force a schema update, not vanish). Refuse, don't guess.
 */

/** Where an IR record came from in the original data — kept for auditability. */
export const Provenance = z.strictObject({
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
 * atomic planner consumes these bindings. See docs/ECS.md "Settler AI" and docs/plans/Phase 1.
 */
export const AtomicId = z.number().int().nonnegative();

/**
 * Atomic ids that act on a good, keyed by role (from `goodtypes` `atomicFor*`). A good is the
 * *object* of the atomic: `harvest` cuts/mines/reaps it, `plant`/`cultivate` grow it, `produce`
 * is the atomic a workplace runs to make it.
 */
export const GoodAtomics = z.strictObject({
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
export const ProductionInput = z.strictObject({
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
export const GoodClassification = z.strictObject({
  /** `isProducedOnMapFlag` — a raw good harvested/gathered from the map (wheat, stone, fruit, water). */
  producedOnMap: z.boolean().default(false),
  /** `isProducedInHouseFlag` — a good produced in a workplace (flour, bread, food_simple/food_extra). */
  producedInHouse: z.boolean().default(false),
  /** `isInputGoodFlag` — this good can be consumed as an input by some production recipe. */
  inputGood: z.boolean().default(false),
});
export type GoodClassification = z.infer<typeof GoodClassification>;

/**
 * A character-equipment category — the slot kind a good occupies when a Viking carries it. The
 * original's equippable goods are `goodtypes.ini` ids 30–55 (confirmed by each tribe's `allowequip`
 * list in `tribetypes.ini`, and the manual's Equipment section: "You can equip your Vikings with
 * shoes, tools, mead, potions and amulets" + soldiers additionally with weapons and armour). Weapons
 * and armour are soldier-only; shoes/tools/consumables anyone. This is the SLOT category; the sim's
 * `Equipment` component groups worn goods by it.
 */
export const EQUIP_CATEGORIES = ['boots', 'tool', 'weapon', 'armor', 'misc'] as const;
export const EquipCategory = z.enum(EQUIP_CATEGORIES);
export type EquipCategory = z.infer<typeof EquipCategory>;

/**
 * A good's equipment classification — present only on the equippable goods (the original's ids 30–55).
 * `category` names the slot kind; `wears` marks whether the item is used up in use. The wear split is
 * source-pinned to the manual: potions, shoes and tools are "slowly used up" ("Partly used items
 * (potions, shoes, ...) you drop are lost"), while "unused items such as weapons, armour and amulets
 * can be used again" (amulets: "their power is never diminished"). The per-use consumption MAGNITUDE
 * is engine-hardcoded (no numeric field exists in any readable `.ini` — verified), so no rate lives
 * here; a wearing item just carries a "degree of use" the UI shows as a percentage.
 */
export const EquipClass = z.strictObject({
  category: EquipCategory,
  /** True when the item is consumed with use (potions/shoes/tools); false for permanent gear
   *  (weapons/armour/amulets). Source basis: manual Equipment section (see {@link EquipClass}). */
  wears: z.boolean().default(false),
});
export type EquipClass = z.infer<typeof EquipClass>;

/**
 * A raw good's three-stage gathering pipeline, from the `[goodtype]` `landscapeTo*` fields. The
 * original models gathering as a chain of {@link LandscapeType} states a cell passes through: a
 * settler HARVESTS the source object ({@link harvest} — a `tree`/`rock`/`mine`), it becomes a
 * PICKUP-able intermediate ({@link pickup} — a `trunk`/`ore`), and the finished good rests on the
 * ground as a STORE landscape ({@link store} — `wood`/`stone`) until a carrier stocks it. Wood is
 * `tree(4) → trunk(6) → wood(7)`. Present only on the ~11 map-gathered goods; a produced/in-house
 * good (flour, bread) carries none. The resolved good→landscape→gfx join is emitted once as the
 * {@link GatheringPipeline} artifact so consumers don't re-derive it. Absent stage = the source
 * omits that lane (honey has no {@link harvest} — it is picked up, not cut).
 */
export const GoodGathering = z.strictObject({
  /** `landscapeToHarvest` — the source landscape a settler works to start the pipeline (wood: `tree`=4). */
  harvest: TypeId.optional(),
  /** `landscapeToPickup` — the intermediate the harvested cell becomes, picked up next (wood: `trunk`=6). */
  pickup: TypeId.optional(),
  /** `landscapeToStore` — the finished good resting on the ground before it is stocked (wood: `wood`=7). */
  store: TypeId.optional(),
  /** `isBioLandscapeFlag` — the pipeline's landscapes are living/growing (trees, herb, mushroom) vs mined (stone, ore, gold). */
  bioLandscape: z.boolean().default(false),
  /**
   * **OBSERVED, not extracted** — how many chop atomics fell a standing node of this good before it
   * drops its whole yield as a ground trunk (the tree→"tree falling"→trunk lifecycle the
   * {@link harvest}/{@link pickup} stages name). The readable `.ini` carries NO such count (no
   * `baserepeatcounter` for the collector job — verified absent), so this is a calibration constant
   * a scene/fixture sets and `source basis` tracks ("observed, pending calibration against the
   * original"). `0` (the default, and what the extractor emits) means **not a felling good** — a
   * single-hit gather (stone/clay yield one unit per swing, the node persisting), the pre-felling
   * behaviour Step 4 reworks. `> 0` marks a fell-once-whole-yield good (wood) — the sim stamps a
   * `Felling` component on such a node so the harvest atomic chops it down instead of yielding a unit.
   */
  chopsToFell: z.number().int().nonnegative().default(0),
  /**
   * **OBSERVED, not extracted** — the whole-node yield a felled node drops as its ground trunk (units
   * of this good). Like {@link chopsToFell} the readable data carries no per-tree wood count, so this
   * is a calibration constant (source basis). Only meaningful when {@link chopsToFell} `> 0` (a
   * felling good); the sim stamps it as the node's `Resource.remaining`, released in full as the trunk
   * pile when the node falls. `0` (the default) leaves it to the spawn site.
   */
  yieldPerNode: z.number().int().nonnegative().default(0),
  /**
   * **OBSERVED, not extracted** — the units a MINED deposit of this good holds (stone/iron/gold/clay).
   * The readable `.ini` has no field established to be the harvestable-unit count: `landscapetypes.ini`
   * `maximumValency` is a per-CELL valency (constant across a good's stages — mud_mine = mud_ore = mud = 6,
   * and a 1-unit dropped ore pile shares it), NOT the deposit size, so this stays a calibration constant a
   * scene/fixture sets and `source basis` tracks (unlike {@link depositLevels}, which IS gfx data).
   * `> 0` marks a **mined** good — a
   * distinct-`landscapeToPickup` "ore" deposit the collector chips one unit at a time, dropping each as a
   * ground ore pile and shrinking the node by level until empty (the sim stamps a `MineDeposit` on such a
   * node). `0` (the default, and what the extractor emits) means NOT a mined good — a fell-once tree
   * (`chopsToFell > 0`) or the trivial direct pickup (a mushroom, harvested straight onto the back).
   */
  depositSize: z.number().int().nonnegative().default(0),
  /**
   * The number of discrete VISUAL fill states a mined deposit steps down through as it empties. **DATA,
   * not yet plumbed here** — this IS the deposit's harvest `[GfxLandscape]` record's own state count
   * (`frames.length`/`maxValency`: the `ls_ground` clay/iron/gold mines carry 5, stone's rock 4, mushroom
   * 1 — the render already derives it directly in `nodeLevelBobs`, see source basis), so it is NOT an
   * observed guess. The extractor emits `0` for now (a future join would copy the harvest record's frame
   * count here); the sim stamps it on the deposit's `MineDeposit` so `render` buckets `remaining/depositSize`
   * into the right fill-state frame. Only meaningful when {@link depositSize} `> 0`; `0` (the default)
   * leaves the per-good level count to the spawn site (which sets it to match that good's gfx).
   */
  depositLevels: z.number().int().nonnegative().default(0),
});
export type GoodGathering = z.infer<typeof GoodGathering>;

export const GoodType = z.strictObject({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  atomics: GoodAtomics.default({}),
  /**
   * `landscapetype` — the {@link LandscapeType} that represents this good as a placed object on the
   * map (its "on the ground" lane). Present on every good: for a gathered good it equals the
   * {@link GoodGathering.store} stage (`wood`=7), for a produced good it is a distinct dropped-good
   * type, and for a non-landscape good (a vehicle/animal token) it is the `void` type (1).
   */
  landscapeType: TypeId.optional(),
  /**
   * The three-stage map-gathering pipeline, when this is a raw map-gathered good — the
   * `landscapeTo{Harvest,Pickup,Store}` chain + `isBioLandscapeFlag`. Omitted for a produced/in-house
   * good. See {@link GoodGathering} and the resolved {@link GatheringPipeline} artifact.
   */
  gathering: GoodGathering.optional(),
  /**
   * Input goods (+ per-cycle amounts) consumed to produce THIS good — the input side of the goods
   * graph, from `goodtypes` `productionInputGoods`. Empty for a raw/harvested good (no recipe). This
   * is the source the building `recipe` inputs are filled from (the workplace's `produces` output good
   * names the output; this good's `productionInputs` names what that cycle consumes). See historical plan phase 3.
   */
  productionInputs: z.array(ProductionInput).default([]),
  /**
   * The good's node layer in the goods graph, from the `[goodtype]` boolean flags — distinguishes a
   * raw (map-gathered) good from a produced (in-house) one, and marks which goods are recipe inputs.
   * The {@link productionInputs} edges plus these layers are the explicit goods-graph IR. See
   * {@link GoodClassification} and historical plan phase 3.
   */
  classification: GoodClassification.default({}),
  /**
   * The good's character-equipment classification — its slot category + whether it wears out. Present
   * only on the equippable goods (the original's ids 30–55: shoes, tools, armour, weapons, mead,
   * potions, amulets); omitted for every economy good. Consumed by the sim's `Equipment` component and
   * the selection UI's equipment-slots row. See {@link EquipClass}.
   */
  equip: EquipClass.optional(),
  source: Provenance.optional(),
});
export type GoodType = z.infer<typeof GoodType>;

export const JobType = z.strictObject({
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
export const HumanJobExperienceType = z.strictObject({
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

export const StockSlot = z.strictObject({
  goodType: TypeId,
  capacity: z.number().int().nonnegative(),
  initial: z.number().int().nonnegative().default(0),
});
export type StockSlot = z.infer<typeof StockSlot>;

export const WorkerSlot = z.strictObject({
  jobType: TypeId,
  count: z.number().int().nonnegative(),
});
export type WorkerSlot = z.infer<typeof WorkerSlot>;

/** A recipe: a workplace turns inputs into outputs over time. */
export const Recipe = z.strictObject({
  inputs: z.array(z.strictObject({ goodType: TypeId, amount: z.number().int().positive() })).default([]),
  outputs: z.array(z.strictObject({ goodType: TypeId, amount: z.number().int().positive() })).default([]),
  /** Game ticks to complete one production cycle. */
  ticks: z.number().int().positive().default(20),
});
export type Recipe = z.infer<typeof Recipe>;

/** One HALF-CELL offset of a building footprint, relative to the building's placed anchor node —
 *  the original's `2W×2H` logic lattice, the same grid `map.cif` placements address. Extracted
 *  verbatim from the source's `<x> <y>` values. */
export const FootprintCell = z.strictObject({
  dx: z.number().int(),
  dy: z.number().int(),
});
export type FootprintCell = z.infer<typeof FootprintCell>;

/**
 * A building type's ground footprint, extracted from the graphics table's `[GfxHouse]` record (the
 * readable `DataCnmd/budynki12/houses/houses.ini`) — the collision/placement model the original
 * carries per house. All cells are HALF-CELL offsets from the building's anchor node, each
 * source line `<x> <y> <run>` expanding to `run` half-cells starting at `(x, y)` and extending
 * along +x (the `2W×2H` lattice every map lane addresses).
 *
 *  - `blocked` — `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` for THIS type's size level: the cells
 *    the standing building makes unwalkable (its physical body — settlers cannot path through them).
 *  - `familyBody` — the union of `blocked` across ALL the record's size levels: the largest body the
 *    building can grow to through its upgrade chain (a level-0 hut's future max-level walls).
 *  - `reserved` — `familyBody` ∪ the record's `LogicBuildBlockArea` cells (which the source defines
 *    ONCE per record, with no level index — the level-independent build-exclusion zone). This is the
 *    area the building keeps clear of other construction: a level-0 hut reserves exactly what its
 *    top level needs, plus the margin ring the source draws around the walls (the "minimum distance
 *    from other houses / blocking terrain" the original enforces).
 *  - `door` — `LogicDoorPoint <sizeIdx> <x> <y>` for this size level: the entry cell settlers use to
 *    interact with the building (adjacent to the walls for houses; the defence-wall records put it
 *    INSIDE the walk-block — a wall's door is its passable gate, which the sim's nav overlay carves out).
 *
 * Absent on a building the graphics table omits (and on synthetic test content) — such a type places
 * with no collision, blocks nothing, and is interacted with on its anchor tile (the pre-footprint
 * behavior).
 */
export const BuildingFootprint = z.strictObject({
  blocked: z.array(FootprintCell).default([]),
  familyBody: z.array(FootprintCell).default([]),
  reserved: z.array(FootprintCell).default([]),
  door: FootprintCell.optional(),
});
export type BuildingFootprint = z.infer<typeof BuildingFootprint>;

export const BuildingType = z.strictObject({
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
   * schema default until the per-tribe atomic-timing pass pins it (source basis).
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
  construction: z
    .array(z.strictObject({ goodType: TypeId, amount: z.number().int().positive() }))
    .default([]),
  /**
   * Max **hitpoints** — the building's full life pool, from the graphics table's `[GfxHouse]`
   * `logichitpoints` line (`DataCnmd/budynki12/houses/houses.ini`), overlaid by `typeId` exactly like
   * {@link construction}. A home's level chain resolves each tier's own value (typeIds 2..6 =
   * 30000/40000/60000/70000/80000); walls are 100000, small workplaces ~25000–40000. During
   * construction the sim ramps a {@link import('@vinland/sim')} `Health` pool up to this max as the
   * building rises (a foundation is near-0, a finished building is full). Absent when the graphics
   * table has no record for the type (and on synthetic test content) — a type with no HP simply
   * carries no life pool. source basis: the readable `logichitpoints` param.
   */
  hitpoints: z.number().int().positive().optional(),
  /**
   * Ground footprint (collision body / build-exclusion zone / door cell) from the graphics table's
   * `[GfxHouse]` record, overlaid by `typeId` like {@link construction}. Absent when the graphics
   * table has no record for the type (and on synthetic test content) — see {@link BuildingFootprint}.
   */
  footprint: BuildingFootprint.optional(),
  source: Provenance.optional(),
});
export type BuildingType = z.infer<typeof BuildingType>;

export const WeaponType = z.strictObject({
  /** The weapon's `type` id. NOTE: unlike the other type tables this is NOT globally unique — a
   *  weapon is keyed by `(tribeType, typeId)` in the original `weapontypes`, so the same `typeId`
   *  (e.g. 2 = "fist") recurs once per tribe. Resolve a weapon with both ids, not `typeId` alone. */
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`weapontype` `tribetype`). Part of the composite key — see `typeId`. */
  tribeType: TypeId.optional(),
  /**
   * `mainType` — the coarse **weapon class** (1..7 in the base data: fist/club/sword/axe/spear/bow/…),
   * the weapon-side twin of {@link ArmorType.mainType}. NOT a cross-ref into another table (it's a
   * class enum, not a foreign key) — a soldier-class→weapon-class binding prerequisite the deferred
   * combat-roster slice joins on, captured ahead of that drive. */
  mainType: TypeId.optional(),
  /** `weight` — the encumbrance the weapon adds (0..2 in the base data), the weapon-side twin of
   *  {@link ArmorType.weight}. */
  weight: z.number().int().nonnegative().default(0),
  /**
   * `munitiontype` — the **ammunition class** a *ranged* weapon fires (only bows and catapults carry
   * it in the base data): 1 = bow ammo / arrow, 2 = catapult projectile. Like {@link mainType} it is a
   * class enum, **not** a cross-ref into another table (`munitiontype` appears in no other `.ini`, and
   * the values 1/2 are NOT good ids — good 1 is "water", good 2 is "mud"), so it's captured as a plain
   * id with no cross-ref check. **Absent on melee weapons** (a fist/sword fires nothing → `undefined`),
   * making it the data-pinned "is this weapon ranged" marker the deferred ranged-attack drive reads. */
  munitionType: TypeId.optional(),
  /**
   * `speed` — a **ranged** weapon's projectile **travel speed** (short/long bow `8`, house bow `7`,
   * catapult `3` in the base data — a bow's arrow flies faster than a catapult's rock). Carried only by
   * the rows that also carry a {@link munitionType} (bows + catapults); **absent on every melee weapon**
   * (→ `undefined`), the {@link munitionType} twin. Captured as a plain non-negative int (a magnitude,
   * not a cross-ref — `speed` appears in no other table). The **UNIT is unreadable** (tiles/tick? — the
   * source carries no scale), so the ranged-combat drive maps it onto a per-tick step via a named
   * calibration constant (source basis "Combat ranged projectiles"); the extracted value itself is faithful. */
  speed: z.number().int().nonnegative().optional(),
  /**
   * `damagetype` — the **damage class** a weapon deals (a siege/area marker in the base data: only the
   * catapults carry it, value `2`). Like {@link mainType} and {@link munitionType} it is a class enum,
   * **not** a cross-ref into another table (`damagetype` appears in no other `.ini`, and `2` is not a
   * good id — good 2 is "mud"), so it's captured as a plain id with no cross-ref check. **Absent on
   * every non-catapult weapon** (→ `undefined`), so it marks the siege/AoE damage class the deferred
   * combat-resolution drive reads, the twin of {@link munitionType}'s "is ranged" marker. */
  damageType: TypeId.optional(),
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

export const ArmorType = z.strictObject({
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
export const AnimalType = z.strictObject({
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

export const VehicleType = z.strictObject({
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

/** An RGB colour as a `[r, g, b]` int tuple (0..255 in practice; not range-checked — faithful passthrough). */
export const RgbColor = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
export type RgbColor = z.infer<typeof RgbColor>;

/**
 * One `[trianglepatterntype]` from `Data/logic/trianglepatterntypes.cif` — the **logic classification**
 * of the terrain triangles (water / land / mountain / sand / beach / desertStone / moor / snow / plaster
 * / blocked): 10 records, `type` ids 1..10. This is the cross-reference target of a {@link GfxPattern}'s
 * {@link GfxPattern.logicType}: every visual ground tile is classified as one of these logic types, which
 * carries the walk/build/water semantics + a per-type debug colour. The boolean flags are
 * **absent-means-false** — the source omits a `0` flag entirely (e.g. the `water` record lists no
 * `humancanwalkon`), so a missing key is a `false`, not unknown.
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
   * `debugcolor` R G B — the flat per-type colour. The cheap legible terrain fallback: rendering a cell
   * by its type's debug colour when the real `text_*` texture is deferred. `undefined` when absent.
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
 * One `[GfxPattern]` from `Data/engine2d/inis/patterns/pattern.cif` — the **texture→cell binding** for
 * the triangle-mesh terrain (927 records). A pattern names a `text_NNN.pcx` ground texture and the two
 * triangles' UVs ({@link coordsA}/{@link coordsB}) that tile a diamond cell out of it, classified by a
 * {@link logicType} (a {@link TrianglePatternType.type} cross-ref).
 *
 * The record carries **no explicit id field** — the engine references a pattern by its **position** in
 * the list, so {@link id} is the 0-based index. Because of that, the extractor must keep every record
 * (skipping one would renumber the rest): the visual fields are therefore optional rather than
 * skip-on-missing, so even a degenerate record still occupies its positional slot. In the real data all
 * 927 records are well-formed (name + texture + 6-int coords + a `logicType` of 0..10, where `0` is the
 * misc/border tiles that classify to no logic type).
 */
export const GfxPattern = z.strictObject({
  /** The 0-based position in the `GfxPattern` list — the engine's positional pattern id (no explicit field exists). */
  id: z.number().int().nonnegative(),
  /** `EditName` — the editor label (e.g. `"block desertStone 01 03 01"`). */
  editName: z.string().optional(),
  /** `EditGroups` — the editor grouping tags (e.g. `"meadow all"`, `"meadow green"`), kept verbatim; a record may list several. */
  editGroups: z.array(z.string()).default([]),
  /** `LogicType` — the {@link TrianglePatternType.type} this tile classifies as; `0` for the misc/border tiles with no logic type. */
  logicType: TypeId.default(0),
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
 * A transition lane's "no overlay here" sentinel (u8 max) — the shared half of the `emt1..emt4`
 * encoding contract between the pipeline's lane validation, this schema's refine, and the render's
 * decode (`packages/render/src/data/terrain.ts` keeps a documented local twin — that package stays
 * import-decoupled from `@vinland/data` by design).
 */
export const TRANSITION_NONE = 255;

/**
 * The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines) — the
 * divisor of the `emt` lane encoding: `⌊value / 6⌋` picks the record, `value % 6` the pair. Shared
 * like {@link TRANSITION_NONE}.
 */
export const TRANSITION_PAIRS = 6;

/**
 * One `[transition]` from `Data/engine2d/inis/patterntransitions/transitions.cif` — a **ground
 * transition overlay** (38 records): a translucent 256×256 texture blended over the base pattern
 * where two ground families meet. A record names an RGB texture and a separate alpha-mask picture
 * ({@link texture}/{@link textureAlpha} — the pipeline composes them into one RGBA page), plus SIX
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

/**
 * The **approximated** per-landscape-typeId ground binding — the typeId→pattern map the terrain renderer
 * consumes (historical plan phase 2, step 2). Every map cell carries a {@link LandscapeType.typeId} (1-based, the
 * `lmlt` per-cell value), but those types are mostly OBJECTS (void/tree/rock/iron/wheat…), not ground
 * classes. This table approximates each typeId's GROUND by a coarse **family** — its `id` slug naming
 * water → `water`, `rock`/`stone` → `mountain`, everything else (incl. tree/bush/wood, whose ground is
 * land) → `land` — and binds the family to ONE representative {@link GfxPattern} (its `text_NNN` texture +
 * the two triangles' UVs). **This is a deviation, not a 1:1 match** (source basis): the original
 * computes the per-cell pattern from corner types + variant lanes, an oracle-blocked algorithm. The
 * `debugColor` is the flat-tint fallback when the texture is unavailable.
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

/**
 * One footprint entry of a `[GfxLandscape]` record's repeated `LogicWalkBlockArea` /
 * `LogicBuildBlockArea` / `LogicWorkArea` lines: `<state> <dx> <dy> <run>` — for the object's fill
 * state `state`, a horizontal RUN of `run` HALF-CELL offsets starting at `(dx, dy)` relative to the
 * object's anchor node (the `emla`/`lmlt` lanes' own `2W×2H` grid). Extracted verbatim; consumed by
 * `fullStateBlockAreaCells` (the shared full-state reading the sim's resource footprints and the
 * app's map-collision join both class by).
 */
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
export const AtomicBinding = z.strictObject({
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

export const JobEnables = z.strictObject({
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

export const JobRequirement = z.strictObject({
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

export const TribeType = z.strictObject({
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
export const AtomicEvent = z.strictObject({
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
export const AtomicAnimation = z.strictObject({
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
 * (docs/plans/Phase 5), a far larger vocabulary than this metadata slice. See docs/SOURCES.md.
 */
export const MapInfo = z.strictObject({
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
  campaign: z.strictObject({ campaignId: z.number().int(), missionId: z.number().int() }).optional(),
  /** String-table id of the map's display name (`misc_mapname` `mapnamestringid`) — resolved against the locale strings, a later step. */
  nameStringId: z.number().int().optional(),
  /** String-table id of the map's description (`misc_mapname` `mapdescriptionstringid`). */
  descriptionStringId: z.number().int().optional(),
  source: Provenance.optional(),
});
export type MapInfo = z.infer<typeof MapInfo>;

/**
 * The 1:1 ground-texture layer of a decoded map: the original's `empa`/`empb` per-cell lanes hold the
 * **final per-triangle {@link GfxPattern} choice** (the editor bakes its pattern algorithm's output
 * into the save), referenced through the map's own `eapd` pattern-name dictionary. {@link patterns}
 * is that dictionary compacted to the names this map actually uses; {@link a}/{@link b} give each
 * cell's two triangles (A = top, B = bottom of the diamond) as indices into it. The renderer joins a
 * name onto the extracted {@link GfxPattern} table (`EditName` is the engine's own version-robust
 * join key) for the texture page + UV coords.
 */
export const TerrainGround = z.object({
  /** The pattern `EditName`s this map uses (compacted from the map's `eapd` dictionary). */
  patterns: z.array(z.string()),
  /** Row-major per-cell index into {@link patterns} for triangle A (length = width*height). */
  a: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell index into {@link patterns} for triangle B (length = width*height). */
  b: z.array(z.number().int().nonnegative()),
});
export type TerrainGround = z.infer<typeof TerrainGround>;

/**
 * The transition-overlay layer of a decoded map: the original's `emt1..emt4` per-cell u8 lanes,
 * each a per-TRIANGLE overlay pick — `emt1`/`emt2` are layer 1 (drawn last, on top) for triangles
 * A/B, `emt3`/`emt4` layer 2 (under layer 1) for A/B. A lane value `v < 255` selects transition
 * `⌊v/6⌋` from the map's `eatd` dictionary ({@link types}, kept VERBATIM so the positional join
 * survives) and pair variant `v % 6` of its six `GfxCoords` pairs; `255` = no overlay. A name
 * joins onto the extracted {@link GfxPatternTransition} table (`editName`), mirroring how
 * {@link TerrainGround} joins patterns.
 */
export const TerrainTransitions = z.object({
  /** The map's `eatd` transition-name dictionary, VERBATIM (lane `⌊v/6⌋` indexes it positionally). */
  types: z.array(z.string()),
  /** Row-major per-cell `emt1` lane — layer 1 (topmost), triangle A. Raw u8; 255 = none. */
  a1: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt2` lane — layer 1 (topmost), triangle B. Raw u8; 255 = none. */
  b1: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt3` lane — layer 2 (under layer 1), triangle A. Raw u8; 255 = none. */
  a2: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt4` lane — layer 2 (under layer 1), triangle B. Raw u8; 255 = none. */
  b2: z.array(z.number().int().nonnegative()),
});
export type TerrainTransitions = z.infer<typeof TerrainTransitions>;

/**
 * The placed landscape objects of a decoded map: the original's `emla` lane is a **half-cell**
 * (2·width × 2·height) grid of indices into the map's `eald` object-name dictionary — every tree,
 * stone, bush, mine decal and animated wave the map ships. {@link types} is that dictionary compacted
 * to the names actually placed; {@link placements} is the sparse flat list of `[hx, hy, typeIndex]`
 * triples (half-cell coordinates — divide by 2 for the cell, the remainder is the sub-cell corner),
 * row-major order. A name joins onto the {@link LandscapeGfx} table for the object's bob frames,
 * palette, animation flags and logic footprints.
 */
export const TerrainObjects = z.object({
  /** The `[GfxLandscape]` `EditName`s this map places (compacted from the map's `eald` dictionary). */
  types: z.array(z.string()),
  /** Flat `[hx, hy, typeIndex]` triples in row-major half-cell order (length % 3 === 0). */
  placements: z.array(z.number().int().nonnegative()),
  /**
   * Per-placement object LEVEL from the `lmlv` lane (parallel to {@link placements}, one entry per
   * triple): 1-based and counting UP FROM THE LOWEST state, while the type's {@link LandscapeGfx}
   * `frames` lists are authored highest-first — so level N (= the list count) is the full-grown
   * tree / full deposit / intact wall (the FIRST list) and level 1 the sapling / dregs / rubble
   * (the last); consumers map `index = N − level`. Walls carry the sentinel `100` (= intact); that
   * and any other out-of-range value render the first (full) list. Absent on maps decoded before
   * the lane was understood (render then defaults to the full state). Direction pinned against the
   * screenshot corpus (source basis "Landscape-object layer").
   */
  levels: z.array(z.number().int().nonnegative()).optional(),
});
export type TerrainObjects = z.infer<typeof TerrainObjects>;

/**
 * The map's authored entity placements — the `map.cif` `StaticObjects` verbs (`sethouse`/`sethuman`/
 * `setanimal`) decoded verbatim: names stay the original strings (a `sethouse` name is the `[GfxHouse]`
 * `EditName`, a `sethuman` role a `[jobtype]` name), and coordinates stay **half-cells** (the same
 * `2W × 2H` lattice {@link TerrainObjects} uses; `÷2` → cell). Resolution to sim typeIds happens at
 * load by NAME against the IR ({@link BuildingBob} `editName`+`level`, {@link JobType} `name`) — the
 * engine's own version-robust join, mirroring how {@link TerrainGround} joins patterns. The
 * `addgoods`/`setproducedgood`/`setguide` verbs (stock, production presets, scout guides) are NOT
 * captured yet — a tracked gap (source basis map-entity import).
 */
export const TerrainEntities = z.object({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is read as
   * 1-based — an ASSUMPTION, not a pin: the column is the constant `1` across all 13 entity-bearing
   * maps (untestable from data; the other player-carrying map sections are 0-based), so verify by
   * observing ownership in the running original (source basis "Authored entity placements").
   * `rot` is decoded verbatim with no consumer yet — the rotation→facing slice is deferred
   * (docs/plans/entity-import item).
   */
  buildings: z
    .array(
      z.strictObject({
        name: z.string(),
        level: z.number().int().nonnegative(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        rot: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
  /** `sethuman` placements: tribe + `[jobtype]` role names; `player` is the verb's first value (0-based). */
  humans: z
    .array(
      z.strictObject({
        tribe: z.string(),
        role: z.string(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  /** `setanimal` placements: species name (an `[animaltype]` tribe, e.g. `hares`). */
  animals: z
    .array(
      z.strictObject({
        species: z.string(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});
export type TerrainEntities = z.infer<typeof TerrainEntities>;

/**
 * A decoded terrain grid file (`content/maps/<id>.json`) — the per-map nav-graph input the pipeline
 * emits from `map.dat` (the `lmlt` half-cell landscape-object lane reduced to one typeId per cell;
 * raw values ARE the 1-based IR {@link LandscapeType} typeIds, with raw 0 = "no object" mapped to
 * `void`). This is the on-disk twin of the sim's `TerrainMap` (the sim defines that structural type
 * without zod; this schema is the validating loader boundary so the build tool / app can
 * `parseTerrainMap` a file before it ever reaches the pure sim). The
 * `typeIds.length === width * height` invariant is enforced here so a truncated/oversized grid fails
 * at load, not as a confusing out-of-bounds read inside `buildTerrainGraph`.
 *
 * The optional {@link ground} / {@link objects} layers carry the map's 1:1 visual data (per-triangle
 * ground patterns; placed landscape objects) — render-only consumers; the sim reads only the grid.
 * The optional {@link elevation} (`lmhe` terrain height) and {@link brightness} (`embr` baked
 * shading) lanes are per-cell render inputs: the projection lift and the ground's per-fragment
 * shading respectively.
 */
export const TerrainMapFile = z
  .strictObject({
    /** Map width in cells. */
    width: z.number().int().positive(),
    /** Map height in cells. */
    height: z.number().int().positive(),
    /** Row-major landscape typeId per cell (length must equal width*height). */
    typeIds: z.array(TypeId),
    /** The 1:1 per-triangle ground patterns (`empa`/`empb` + `eapd`), when the map carries them. */
    ground: TerrainGround.optional(),
    /** The per-triangle transition overlays (`emt1..emt4` + `eatd`), when the map carries them. */
    transitions: TerrainTransitions.optional(),
    /** The placed landscape objects (`emla` + `eald`), when the map carries them. */
    objects: TerrainObjects.optional(),
    /**
     * Per-cell terrain height (`lmhe` lane), row-major, one value per cell (length = width*height) —
     * NOT the `2W × 2H` half-cell resolution the {@link objects} lane uses. Raw byte values, 0..250
     * (a hard observed ceiling across the real maps).
     * Present when the map ships the lane (older/foreign saves omit it). Consumed by the render's
     * elevation lift (≈1.24 native px/unit, MEASURED — see source basis "projection";
     * `packages/render/src/data/elevation.ts`).
     */
    elevation: z.array(z.number().int().nonnegative()).optional(),
    /**
     * Per-cell baked brightness (`embr` lane), row-major, one value per cell (length = width*height),
     * raw byte values 0..255 with 127 = neutral. The engine's baked shading plane: slope light/shadow
     * plus the fade-to-black map border (the outermost 2–3 rows/columns hold 0). Present when the map
     * ships the lane. Consumed by the ground's per-fragment shading (luminance × brightness/127,
     * the response curve calibrated against the reference corpus —
     * `packages/render/src/data/brightness.ts`).
     */
    brightness: z.array(z.number().int().nonnegative()).optional(),
    /** The authored entity placements (`map.cif` `StaticObjects`), when the map carries them. */
    entities: TerrainEntities.optional(),
  })
  .refine(
    (m) => m.typeIds.length === m.width * m.height,
    (m) => ({
      message: `terrain map typeIds length ${m.typeIds.length} != width*height (${m.width}*${m.height} = ${
        m.width * m.height
      })`,
      path: ['typeIds'],
    }),
  )
  .refine(
    (m) =>
      m.ground === undefined ||
      (m.ground.a.length === m.width * m.height && m.ground.b.length === m.width * m.height),
    (m) => ({
      message: `terrain map ground lanes must be width*height (${m.width * m.height}) cells`,
      path: ['ground'],
    }),
  )
  .refine(
    (m) =>
      m.ground === undefined ||
      [...m.ground.a, ...m.ground.b].every((idx) => idx < (m.ground as TerrainGround).patterns.length),
    () => ({
      message: 'terrain map ground lane indexes outside its patterns list',
      path: ['ground'],
    }),
  )
  .refine(
    (m) => {
      if (m.transitions === undefined) return true;
      const cells = m.width * m.height;
      const t = m.transitions;
      return [t.a1, t.b1, t.a2, t.b2].every((lane) => lane.length === cells);
    },
    (m) => ({
      message: `terrain map transition lanes must be width*height (${m.width * m.height}) cells`,
      path: ['transitions'],
    }),
  )
  .refine(
    (m) => {
      if (m.transitions === undefined) return true;
      const t = m.transitions;
      return [t.a1, t.b1, t.a2, t.b2].every((lane) =>
        lane.every((v) => v === TRANSITION_NONE || Math.floor(v / TRANSITION_PAIRS) < t.types.length),
      );
    },
    () => ({
      message: 'terrain map transition lane values outside its types dictionary',
      path: ['transitions'],
    }),
  )
  .refine(
    (m) => m.objects === undefined || m.objects.placements.length % 3 === 0,
    () => ({
      message: 'terrain map objects.placements must be flat [hx, hy, typeIndex] triples',
      path: ['objects', 'placements'],
    }),
  )
  .refine(
    (m) => {
      if (m.objects === undefined) return true;
      const p = m.objects.placements;
      for (let i = 0; i + 2 < p.length; i += 3) {
        const hx = p[i] as number;
        const hy = p[i + 1] as number;
        if (hx >= m.width * 2 || hy >= m.height * 2) return false;
        if ((p[i + 2] as number) >= m.objects.types.length) return false;
      }
      return true;
    },
    () => ({
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
      path: ['objects', 'placements'],
    }),
  )
  .refine(
    (m) => m.objects?.levels === undefined || m.objects.levels.length === m.objects.placements.length / 3,
    () => ({
      message: 'terrain map objects.levels must carry one entry per placement triple',
      path: ['objects', 'levels'],
    }),
  )
  .refine(
    (m) => m.elevation === undefined || m.elevation.length === m.width * m.height,
    (m) => ({
      message: `terrain map elevation length ${m.elevation?.length} != width*height (${m.width * m.height})`,
      path: ['elevation'],
    }),
  )
  .refine(
    (m) => m.brightness === undefined || m.brightness.length === m.width * m.height,
    (m) => ({
      message: `terrain map brightness length ${m.brightness?.length} != width*height (${m.width * m.height})`,
      path: ['brightness'],
    }),
  );
export type TerrainMapFile = z.infer<typeof TerrainMapFile>;

/**
 * One named animation run from `animations.ini`'s `[bobseq]` (`seq "<name>" <start> <length>`) — a
 * directional bob cycle laid out as `dirs` facings back-to-back inside one bob set. The render builds
 * its `DirectionalAnim` from this: `start` is the run's first bob id, `length` the total frame count
 * across all directions (so the per-direction stride is `length / dirs`, `dirs` = 8 for these sprites).
 * This is the data the renderer previously hard-coded as frame-range constants (`WALK` start 1988, …);
 * extracting it removes the guesswork — the frame ids come from the source, not a magic number.
 */
export const BobSequence = z.strictObject({
  /** The exact sequence name (`seq "<name>"`) — the resolvable key, e.g. `human_man_generic_walk`. */
  name: z.string(),
  /** The run's first bob id (frame 0 of direction 0). */
  start: z.number().int().nonnegative(),
  /** Total frame count across every direction (`= dirs * per-direction stride`). */
  length: z.number().int().nonnegative(),
});
export type BobSequence = z.infer<typeof BobSequence>;

/**
 * The `[bobseq]` table for one bob set (`imagelib`) from `animations.ini` — its `imagelib` `.bmd` plus
 * every named {@link BobSequence} that indexes into it. The renderer joins a sequence to a decoded atlas
 * by the `imagelib` stem (`cr_hum_body_00.bmd` → the `cr_hum_body_00.<palette>` atlas), the same id space
 * the bob ids address. Render-binding data (like {@link TerrainPattern}); the pure sim ignores it.
 */
export const BobSequenceSet = z.strictObject({
  /** The bob set this table indexes, normalized (lower-case, forward slashes), e.g. `cr_hum_body_00.bmd`. */
  imagelib: z.string(),
  /** The matching shadow bob set (`shadowlib`), normalized, when the record names one. */
  shadowlib: z.string().optional(),
  /** Named sequences in file order. */
  sequences: z.array(BobSequence).default([]),
  source: Provenance.optional(),
});
export type BobSequenceSet = z.infer<typeof BobSequenceSet>;

/**
 * One `[gfxanimatomic]` record from `mapmoveableanimations/animations.ini` — the atomic-action → body
 * animation binding, joining `(logictribe, logicjob, logicatomicaction)` to the `gfxbobseqbody`
 * `[bobseq]` it plays and, crucially, the **explicit per-direction frame-index lists** that lay that
 * animation out across the 8 facings. Render-binding data (like {@link BobSequenceSet}); the pure sim
 * ignores it.
 *
 * This is the directional layout a {@link BobSequence}'s bare `start`/`length` CANNOT encode: an action
 * animation is NOT a uniform `length / 8` strip. Each `gfxanimframelistdir <dir> <idx…>` line gives one
 * facing its own ordered list of LOCAL frame indices into the bodySeq pool (global bob id =
 * `bodySeq.start + idx`), and those lists differ per facing and author holds/repeats inline (a spear
 * windup repeats its first frame five times, `[79,79,79,79,79,80,…]`) and reuse (mirror directions share
 * frames). A melee swing pool is not even divisible by 8 (`Sword_Attack` 102, `spear_attack` 108), so a
 * `start + facing*stride` slice is meaningless — playback must replay these lists verbatim. A record with
 * a single non-directional `gfxanimframelist` yields ONE list ({@link dirFrames} length 1 = facing-locked).
 */
export const GfxAnimAtomic = z.strictObject({
  /** `logictribe` the record binds — the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2, …), NOT
   *  the tribetypes `logicType`. The same `(job, action)` recurs per tribe with DIFFERENT frame lists, so
   *  a consumer MUST filter by the right tribe (viking = 1) or it draws a plausible-but-wrong swing. */
  tribe: z.number().int().nonnegative(),
  /** `logicjob` — the soldier/settler jobType whose atomic this animates (soldiers 31..41, civilist 6, woman 5). */
  job: z.number().int().nonnegative(),
  /** `logicatomicaction` — the atomic slot (81 ATTACK, …), the same numeric id the sim's `setatomic` join keys. */
  action: z.number().int().nonnegative(),
  /** The `gfxbobseqbody` `[bobseq]` name whose frame pool the {@link dirFrames} index into. */
  bodySeq: z.string(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. Extracted ahead
   *  of a consumer: the render currently draws the head at the body's resolved bob id (the head atlas
   *  covers every body frame), so this is unread today — kept for a future separate-head attack overlay. */
  headSeq: z.string().optional(),
  /**
   * Per-direction frame-index lists — one array per facing (`gfxanimframelistdir <dir> <idx…>` placed at
   * its `<dir>` slot, so `dirFrames[d]` is facing `d` regardless of file order), each a list of LOCAL
   * indices into the {@link bodySeq} pool. A non-directional record (`gfxanimframelist`) yields a single
   * list (length-1 outer array = facing-locked). Replayed verbatim — the authored holds/repeats ARE the
   * cadence, never a uniform slice.
   */
  dirFrames: z.array(z.array(z.number().int().nonnegative())),
  source: Provenance.optional(),
});
export type GfxAnimAtomic = z.infer<typeof GfxAnimAtomic>;

/**
 * One `[GfxHouse]` building-type → house-bob binding: which atlas bob a building of a given
 * `(tribeId, typeId)` draws, the data-pinned twin of the renderer's hand-transcribed per-type table.
 * Each `[GfxHouse]` record pairs a `LogicType <level> <typeId>` table with a `GfxBobId <level> <bobId>`
 * table by the **level index** (a home spans levels 0..4, five distinct typeIds at five rising bobs),
 * and names the body `.bmd` (`GfxBobLibs`) recoloured by one-or-more palette skins (`GfxPalette`); this
 * is one row of that join — a single `(tribeId, typeId, level)` resolved to its `(bmd, palette, bobId)`.
 * Render-binding data (like {@link BobSequenceSet}/{@link TerrainPattern}); the pure sim ignores it. The
 * render picks the row matching the atlas it loaded — `(bmd, palette)` — and draws `bobId` for the
 * building's `Building.buildingType` ({@link typeId}), so each type shows its own house bob from data
 * instead of a transcribed constant.
 */
export const BuildingBob = z.strictObject({
  /** The `LogicTribeType` the record applies to (viking 1, frank 2, …) — the same logic `typeId` recurs per tribe. */
  tribeId: z.number().int().nonnegative(),
  /** The building `typeId` (the sim's `Building.buildingType`, the `[GfxHouse]` `LogicType` value at this level). */
  typeId: z.number().int().nonnegative(),
  /** The growth/size level index (`LogicType`/`GfxBobId`'s leading int) — a home's tier 0..4. */
  level: z.number().int().nonnegative(),
  /** The body bob set, normalized (lower-case, forward slashes), e.g. `data/engine2d/bin/bobs/ls_houses_viking.bmd`. */
  bmd: z.string(),
  /** One recolour skin (`GfxPalette` value), lower-cased — the atlas this bob is drawn in (`house01`/`house02`/…). */
  paletteName: z.string(),
  /** The atlas bob id this `(typeId, level)` draws (the `GfxBobId` for the level). */
  bobId: z.number().int().nonnegative(),
  /** The record's `EditName` (`"viking home"`), kept as a render/debug handle when present. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingBob = z.infer<typeof BuildingBob>;

/**
 * One `[GfxHouse]` **construction-stage layer**: `GfxBobConstructionLayer <sizeIdx> <upgrade> <bobId>
 * <shadowBobId|-1> <fromPct> <toPct>` — which atlas bob(s) an under-construction building draws at a
 * given build progress. A record lists several layers per size level with OVERLAPPING `[fromPct,
 * toPct]` ranges; at progress `p` (percent, 0..100) every layer whose range contains `p` draws,
 * STACKED in file order (`stackIdx`) — the last-listed active layer (the finished body, whose range
 * always ends at 100) lands on top. At `p = 0` only the first stage (the grey foundation, range
 * starting at 0) is visible; at `p = 100` only the finished body (+ its shadow) remains.
 *
 * `upgrade` (the source's second int, 0 or 1): the 1-rows reference the NEXT size level's finished
 * body and are NOT part of this level's from-scratch construction — they belong to the original's
 * upgrade-in-progress overlay (semantics not fully decoded; source basis). Consumers of the
 * from-scratch construction render use only the `upgrade === false` rows.
 *
 * Render-binding data like {@link BuildingBob} (same `(tribeId, typeId)` keying, same `(bmd,
 * palette)` atlas resolution); the pure sim ignores it.
 */
export const BuildingConstructionLayer = z.strictObject({
  /** The `LogicTribeType` the record applies to — the same logic `typeId` recurs per tribe. */
  tribeId: z.number().int().nonnegative(),
  /** The building `typeId` at this size level (the `LogicType` value — the sim's `Building.buildingType`). */
  typeId: z.number().int().nonnegative(),
  /** The growth/size level index (the source's leading int) — a home's tier 0..4. */
  level: z.number().int().nonnegative(),
  /** True for the source's `1` rows — the upgrade-overlay layers a from-scratch render skips. */
  upgrade: z.boolean(),
  /** Position of this layer in the record's file order — the stacking order at draw time. */
  stackIdx: z.number().int().nonnegative(),
  /** The body bob set, normalized — the same `.bmd` the type's {@link BuildingBob} rows index. */
  bmd: z.string(),
  /** One recolour skin (`GfxPalette` value), lower-cased. */
  paletteName: z.string(),
  /** The atlas bob to draw while this layer is active. */
  bobId: z.number().int().nonnegative(),
  /** The layer's shadow bob, when the source names one (`-1` = none → absent). */
  shadowBobId: z.number().int().nonnegative().optional(),
  /** Build progress percent at which the layer appears (inclusive). */
  fromPct: z.number().int().min(0).max(100),
  /** Build progress percent up to which the layer stays visible (inclusive). */
  toPct: z.number().int().min(0).max(100),
  /** The record's `EditName`, kept as a render/debug handle when present. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingConstructionLayer = z.infer<typeof BuildingConstructionLayer>;

/**
 * One `SFX "<path>" <n…>` line inside a sound group: the wav to play plus the record's trailing
 * integer parameters, kept verbatim. Their meaning is positional and section-specific — a
 * {@link SoundStaticGroup} carries one volume int (0–100); a {@link SoundAmbient} carries a
 * `(volume, probability, ...)` triple that drives the sparse one-shot birds/wingflaps. We keep the
 * raw list rather than naming each slot so the extractor stays faithful to a format we have only
 * partially reversed — captured for a future audio layer to interpret (per-SFX volume / spawn
 * probability), like {@link SoundStaticGroup.logicSoundType}; today's `@vinland/audio` reads only
 * `file` (gains come from named constants). `file` is normalized to a forward-slash, lower-cased path
 * relative to the sounds root (`data/engine2d/bin/sounds`), so it joins onto the served `/sounds/<file>` route.
 */
export const SoundSfx = z.strictObject({
  /** Wav path relative to `data/engine2d/bin/sounds`, forward-slashed + lower-cased (e.g. `ambient/water3.wav`). */
  file: z.string(),
  /** The trailing integers on the `SFX` line, in file order (volume first; ambient adds probability/period). */
  params: z.array(z.number().int()).default([]),
});
export type SoundSfx = z.infer<typeof SoundSfx>;

/**
 * A `SoundFXStatic` group from `soundfx.cif`: a named bag of interchangeable wavs (the engine picks
 * one at play time) optionally bound to a numeric `LogicSoundType` the original triggers off an
 * animation/job/combat frame. GUI clicks, unit voices ("Viking male ok 13"), animal calls and work
 * sounds are all static groups. We extract every group so future slices can bind the remaining
 * `LogicSoundType`s without re-running the decoder; this slice wires only a hand-picked subset.
 */
export const SoundStaticGroup = z.strictObject({
  /** `Name` — the group's join key (e.g. `"Gui_Click"`, `"Bear Sounds"`, `"Viking male ok 13"`). */
  name: z.string(),
  /** `LogicSoundType` — the numeric engine trigger this group answers to; absent = never auto-triggered. */
  logicSoundType: z.number().int().nonnegative().optional(),
  /** The group's interchangeable wavs (the engine chooses one per play). */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundStaticGroup = z.infer<typeof SoundStaticGroup>;

/**
 * A `SoundFXAmbient` group: a looping/sparse bed tied to terrain the camera frames. It names the
 * terrain `PatternGroup`s (meadow/water/desert/…) and/or landscape `LandscapeGroup`s (tree families)
 * it plays over; the audio layer runs it while any of those are on screen. A single-wav ambient
 * (water, meadow) loops; a multi-wav ambient (the 17 forest birds) plays sparsely by the per-`SFX`
 * probability params.
 */
export const SoundAmbient = z.strictObject({
  /** `Name` — the ambient's handle (e.g. `"Water See"`, `"All Trees"`). */
  name: z.string(),
  /** `PatternGroup` names this ambient covers (join onto the terrain pattern groups), lower-cased. */
  patternGroups: z.array(z.string()).default([]),
  /** `LandscapeGroup` names this ambient covers (tree families etc.), lower-cased. */
  landscapeGroups: z.array(z.string()).default([]),
  /** The bed's wavs — one loops; many play sparsely by their probability params. */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundAmbient = z.infer<typeof SoundAmbient>;

/**
 * A `SoundFXJingle` group: a non-positional life-event stinger (birth, death, house built, marriage,
 * mission won/lost, …) bound to a numeric `MusicType`. Jingles play at full volume with no pan — they
 * are UI feedback, not world sound — so the audio layer treats them distinctly from spatial SFX.
 */
export const SoundJingle = z.strictObject({
  /** `Name` — the jingle handle (e.g. `"Birth"`, `"House Built"`). */
  name: z.string(),
  /** `MusicType` — the numeric engine trigger; absent = handle-only. */
  musicType: z.number().int().nonnegative().optional(),
  /** The jingle's wav(s). */
  sfx: z.array(SoundSfx).default([]),
});
export type SoundJingle = z.infer<typeof SoundJingle>;

/**
 * The decoded `soundfx.cif` sound bank — the data half of audio. Render-binding data the pure sim
 * ignores entirely (like {@link LandscapeGfx}); the browser audio layer joins its groups onto sim
 * events + on-screen terrain to decide what plays. Empty on a checkout whose pipeline hasn't been run
 * against a game copy (`soundfx.cif` absent), so the app degrades to silence, never a crash.
 */
export const SoundBank = z.strictObject({
  staticGroups: z.array(SoundStaticGroup).default([]),
  ambient: z.array(SoundAmbient).default([]),
  jingles: z.array(SoundJingle).default([]),
});
export type SoundBank = z.infer<typeof SoundBank>;

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
  buildingBobs: z.array(BuildingBob).default([]),
  constructionLayers: z.array(BuildingConstructionLayer).default([]),
  tribes: z.array(TribeType).default([]),
  atomicAnimations: z.array(AtomicAnimation).default([]),
  maps: z.array(MapInfo).default([]),
  /** Decoded `soundfx.cif` sound bank (render-binding data; the pure sim ignores it). */
  sounds: SoundBank.default({ staticGroups: [], ambient: [], jingles: [] }),
});
export type ContentSet = z.infer<typeof ContentSet>;

/** Current IR schema version. Bump on breaking schema changes; sim checks the major. */
export const IR_VERSION = 1 as const;
