import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';
import { GoodQuantity } from './goods.js';

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

/** Game ticks for one production cycle when the source pins no atomic-animation length (unpinned). */
export const DEFAULT_RECIPE_TICKS = 20;

/** A recipe: a workplace turns inputs into outputs over time. */
export const Recipe = z.strictObject({
  inputs: z.array(GoodQuantity).default([]),
  outputs: z.array(GoodQuantity).default([]),
  /** Game ticks to complete one production cycle. */
  ticks: z.number().int().positive().default(DEFAULT_RECIPE_TICKS),
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
  construction: z.array(GoodQuantity).default([]),
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
