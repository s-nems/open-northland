import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';
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

/**
 * Game ticks for one production cycle: 15 s at 1× speed, at the sim's 12 ticks/s. A named approximation
 * that replaces the extracted per-animation cycle lengths so every craft paces identically.
 */
export const DEFAULT_RECIPE_TICKS = 180;

/** A workplace turning inputs into one product over time; one recipe per producible good. */
export const Recipe = z.strictObject({
  inputs: z.array(GoodQuantity).default([]),
  outputs: z.array(GoodQuantity).default([]),
  /** Game ticks to complete one production cycle. */
  ticks: z.number().int().positive().default(DEFAULT_RECIPE_TICKS),
});
export type Recipe = z.infer<typeof Recipe>;

/**
 * The coarse building classes, mapped from the original `logichousetype` `logicmaintype`. Which specific
 * building (headquarters vs a stock, which workplace) is carried by `id`.
 */
export const BUILDING_KIND = {
  storage: 'storage',
  home: 'home',
  workplace: 'workplace',
  training: 'training',
  tower: 'tower',
  vehicle: 'vehicle',
  wonder: 'wonder',
} as const;
export type BuildingKind = (typeof BUILDING_KIND)[keyof typeof BUILDING_KIND];

/** The buildings where a settler prays without holy oil of its own: temples first, then the headquarters. */
export const PRAYER_SITE = {
  temple: 'temple',
  headquarters: 'headquarters',
} as const;
export type PrayerSite = (typeof PRAYER_SITE)[keyof typeof PRAYER_SITE];

export const BuildingType = z.strictObject({
  typeId: TypeId,
  id: z.string(), // e.g. "headquarters"
  /** Coarse building class, or the extractor's `maintype_<...>` fallback so an unrecognized
   *  `logicmaintype` degrades one record instead of failing the whole set. */
  kind: z.union([z.enum(BUILDING_KIND), z.templateLiteral(['maintype_', z.string()])]),
  /** Population capacity tier from `logichomesize` - present only on `home` buildings (else 0). */
  homeSize: z.number().int().nonnegative().default(0),
  schoolSize: z.number().int().nonnegative().optional(),
  workers: z.array(WorkerSlot).default([]),
  stock: z.array(StockSlot).default([]),
  /**
   * Good type ids this workplace can produce (`logichousetype` `logicproduction`), in file order. The
   * output side only: the original house table names what a workplace makes, not what it consumes, so
   * the pipeline joins the inputs in through each good's `goodtypes.productionInputGoods`.
   */
  produces: z.array(TypeId).default([]),
  /**
   * One recipe per producible good, materialized by the pipeline from {@link produces} in file order:
   * `inputs` come from that good's `productionInputs`, `outputs` is that single good with its
   * `produces` multiplicity as the amount. Field-farmed goods form no recipe.
   */
  recipes: z.array(Recipe).default([]),
  /**
   * Build-material cost, joined onto the logic record from the graphics table's `[GfxHouse]`
   * `LogicConstructionGoods` line (`DataCnmd/budynki12/houses/houses.ini`, keyed by the same `LogicType`
   * id). Empty for the pre-placed headquarters and for any type the graphics table omits. Each level of
   * a home's chain is a distinct `typeId` carrying its own cost, not a cumulative total.
   */
  construction: z.array(GoodQuantity).default([]),
  /**
   * The `typeId` this building upgrades into: the next size level of the same `[GfxHouse]` record
   * (`LogicType <sizeIdx> <typeId>` mapped at `sizeIdx + 1`), absent on a chain's top level and on
   * single-level buildings. Chains are not homes-only - the real data chains storages (7→8→9), several
   * workplaces, and a tower (40→41). The wonders map every size level to their own typeId, a self-link
   * the extractor skips.
   */
  upgradeTarget: TypeId.optional(),
  /**
   * Max hitpoints from the graphics table's `[GfxHouse]` `logichitpoints` line, overlaid by `typeId`
   * like {@link construction}; each level of a home's chain resolves its own tier. Absent when the
   * graphics table has no record for the type, which simply leaves it with no life pool.
   */
  hitpoints: z.number().int().positive().optional(),
  /**
   * Ground footprint from the graphics table's `[GfxHouse]` record, overlaid by `typeId` like
   * {@link construction}. Absent when the graphics table has no record for the type.
   */
  footprint: BuildingFootprint.optional(),
  /**
   * Extracted `logichousetype` `logicbuildonbiopattern`: the building's walk-block body must stand on
   * ground carrying the vegetation regrow/plant flags. The source sets it for wells and hives.
   */
  buildOnBioPattern: z.boolean().default(false),
  /**
   * The action a settler plays lifting goods off this house's shelf; absent, the generic pick-up. Engine
   * behavior, not an `.ini` key: the original's carrier collect selects action 44 at the well (`logictype`
   * 10) and 45 at the hive (11), else 22.
   */
  collectAtomic: AtomicId.optional(),
  /**
   * The house tops each good it produces up by one unit per game second while below its stock capacity,
   * with no worker: the well's water and the hive's honey. Engine behavior keyed on `logictype` 10 and 11,
   * not an `.ini` key; such a house carries no recipe.
   */
  refillsOwnStock: z.boolean().default(false),
  /**
   * The house is a prayer site whose holy fire burns, with no oil, once the house stands. Engine behavior
   * keyed on `logictype` 37 (temple) and 1 (headquarters), not an `.ini` key. Only a temple blesses the
   * people around it.
   */
  prayerSite: z.enum(PRAYER_SITE).optional(),
  /** Extracted `houses.ini` `logicCanEnableDefenceMode`: whether the player may raise defence mode on it. */
  canEnableDefenceMode: z.boolean().default(false),
  /**
   * How many civilians shelter inside during defence mode, `0` for a type that offers no mode. No readable
   * record carries a garrison size; the original's sizes are overlaid at the app boundary onto the types
   * the flag admits.
   */
  shelterCapacity: z.number().int().nonnegative().default(0),
  source: Provenance.optional(),
});
export type BuildingType = z.infer<typeof BuildingType>;
