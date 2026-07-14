import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';
import { BuildingFootprint } from './building-footprint.js';
import { GoodQuantity } from './goods.js';

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
   * The output side only: the original house table names what a workplace makes, not the input
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
   * Build-material cost — the goods that must be delivered to construct this building, joined onto
   * the logic record from the graphics table's `[GfxHouse]` `LogicConstructionGoods` line (the readable
   * `DataCnmd/budynki12/houses/houses.ini`, keyed by the same `LogicType` id). The source line is a
   * flat good-id list where a repeat encodes quantity (`3 3 26` = 2× stone + pillar), collapsed to
   * `{goodType, amount}` pairs exactly like a recipe's inputs. Empty for the always-present
   * headquarters/wonder buildings (no construction cost) and for any type the graphics table omits.
   * For a home's level chain (`home level 00..04`) each level is a distinct `typeId` carrying its own
   * upgrade cost, so a leveled `home` building resolves the cost of its tier here (not cumulative).
   * The input data the future ConstructionSystem (place → deliver materials → build) consumes.
   */
  construction: z.array(GoodQuantity).default([]),
  /**
   * Max hitpoints — the building's full life pool, from the graphics table's `[GfxHouse]`
   * `logichitpoints` line (`DataCnmd/budynki12/houses/houses.ini`), overlaid by `typeId` exactly like
   * {@link construction}. A home's level chain resolves each tier's own value (typeIds 2..6 =
   * 30000/40000/60000/70000/80000); walls are 100000, small workplaces ~25000–40000. During
   * construction the sim ramps a {@link import('@open-northland/sim')} `Health` pool up to this max as the
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
