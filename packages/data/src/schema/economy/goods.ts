import { z } from 'zod';
import { EquipClass } from '../actors/equipment.js';
import { AtomicId, Provenance, TypeId } from '../record.js';

/**
 * Atomic ids that act on a good, keyed by role (from `goodtypes` `atomicFor*`). A good is the
 * object of the atomic: `harvest` cuts/mines/reaps it, `plant`/`cultivate` grow it, `produce`
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
 * A good paired with a positive per-cycle quantity (`{ goodType, amount }`) — the shared shape of
 * production inputs, recipe inputs/outputs, and construction costs. In every source these come from a
 * flat id list where a repeated id encodes the amount (`… 1 1 14 14 …` = 2×good1 + 2×good14),
 * collapsed to `{ goodType, amount }` pairs in first-seen order.
 */
export const GoodQuantity = z.strictObject({
  goodType: TypeId,
  amount: z.number().int().positive(),
});
export type GoodQuantity = z.infer<typeof GoodQuantity>;

/**
 * One input good consumed to produce this good — the input side of the goods graph. A semantic alias
 * of {@link GoodQuantity} kept under its own name for `productionInputs` and its sim consumers.
 */
export const ProductionInput = GoodQuantity;
export type ProductionInput = GoodQuantity;

/**
 * The game's own classification of a good, from the boolean flags on each `[goodtype]` record — the
 * source-pinned node layers of the goods graph that {@link ProductionInput} edges connect. A good may
 * be several layers at once (a produced good that is itself a recipe input); all default false.
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
 * A raw good's three-stage gathering pipeline, from the `[goodtype]` `landscapeTo*` fields — a chain
 * of {@link LandscapeType} states a cell passes through: a settler harvests the source object
 * ({@link harvest} — a `tree`/`rock`/`mine`), it becomes a pickup intermediate ({@link pickup} — a
 * `trunk`/`ore`), and the finished good rests on the ground as a store landscape ({@link store} —
 * `wood`/`stone`) until stocked. Wood is `tree(4) → trunk(6) → wood(7)`. Present only on map-gathered
 * goods; produced goods carry none. The resolved good→landscape→gfx join is emitted once as
 * {@link GatheringPipeline}. An absent stage means the source omits that lane (honey has no
 * {@link harvest}).
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
   * Observed, not extracted — chop atomics needed to fell a standing node before it drops its whole
   * yield as a ground trunk. The readable `.ini` carries no such count (no collector-job
   * `baserepeatcounter`), so it is a calibration constant a scene/fixture sets. `0` (the extractor
   * default) means not a felling good — a single-hit gather (stone/clay yield one unit per swing, the
   * node persisting). `> 0` marks a fell-once-whole-yield good (wood); the sim stamps a `Felling`
   * component so the harvest atomic chops the node down instead of yielding a unit.
   */
  chopsToFell: z.number().int().nonnegative().default(0),
  /**
   * Observed, not extracted — the whole-node yield a felled node drops as its ground trunk. Like
   * {@link chopsToFell} the readable data carries no per-tree count, so it is a calibration constant.
   * Only meaningful when {@link chopsToFell} `> 0`; the sim stamps it as `Resource.remaining`, released
   * in full as the trunk pile when the node falls. `0` leaves it to the spawn site.
   */
  yieldPerNode: z.number().int().nonnegative().default(0),
  /**
   * Observed, not extracted — the units a mined deposit holds (stone/iron/gold/clay). The readable
   * `.ini` has no field pinned to this: `landscapetypes.ini` `maximumValency` is a per-cell valency
   * (constant across a good's stages — mud_mine = mud_ore = mud = 6), not the deposit size, so it stays
   * a calibration constant. `> 0` marks a mined good — a distinct-`landscapeToPickup` ore deposit the
   * collector chips one unit at a time (the sim stamps a `MineDeposit`). `0` (the extractor default)
   * means not a mined good.
   */
  depositSize: z.number().int().nonnegative().default(0),
  /**
   * Discrete visual fill states a mined deposit steps down through as it empties. Data, not yet plumbed
   * here — this is the harvest `[GfxLandscape]` record's own state count (`frames.length`/`maxValency`:
   * clay/iron/gold mines 5, stone's rock 4, mushroom 1; `render` derives it in `nodeLevelBobs`), but the
   * extractor emits `0` for now. The sim stamps it on `MineDeposit` so `render` buckets
   * `remaining/depositSize` into the right fill-state frame. Only meaningful when {@link depositSize}
   * `> 0`; `0` leaves the per-good level count to the spawn site.
   */
  depositLevels: z.number().int().nonnegative().default(0),
});
export type GoodGathering = z.infer<typeof GoodGathering>;

/**
 * A field-farmed good's cultivation parameters (wheat) — the sow→grow→water→reap loop a farm's worker
 * runs on map fields, distinct from {@link GoodGathering}. The original wires the loop's vocabulary in
 * readable data (`goodtypes.ini` wheat: `atomicForPlanting 34`, `atomicForCultivating 35`,
 * `atomicForHarvesting 29`; `landscapetypes.ini` 27/28/29 = growing/harvested/pile) but its timings and
 * field area live in the native engine, so every number except {@link stages} is an observed
 * calibration constant (see the app's `catalog/farming.ts`).
 */
export const GoodFarming = z.strictObject({
  /**
   * Growth stages a sown field passes before ripe. Data, not observed: the growing landscape's own
   * state count (`landscapetypes.ini` wheat(growing) `maximumValency 5`, matching the `[GfxLandscape]`
   * record's 5 growth frames).
   */
  stages: z.number().int().positive(),
  /** Observed — ticks an unwatered field takes to advance one growth stage (no readable growth timing). */
  ticksPerStage: z.number().int().positive(),
  /** Observed — units a ripe field drops (as a ground sheaf) when reaped. The only related readable
   *  number is `humanjobexperiencetypes.ini` "farmer wheat" `baserepeatcounter 2` (semantics unpinned). */
  yieldPerField: z.number().int().positive(),
  /** Observed — how far from the farm's anchor its workers sow, in half-cell nodes (no radius in data). */
  fieldRadius: z.number().int().positive(),
  /** Observed — the crew-independent part of a farm's field cap. Live cap is
   *  `fieldsBase + fieldsPerFarmer × bound field-farmers`, so the plot grows sublinearly with the crew
   *  (calibration: one farmer works 6 fields, a pair 10). Defaults to 0 (pure per-farmer scaling). */
  fieldsBase: z.number().int().nonnegative().default(0),
  /** Observed — the per-farmer slope of the field cap (see {@link fieldsBase}; no field-count in data). */
  fieldsPerFarmer: z.number().int().positive(),
});
export type GoodFarming = z.infer<typeof GoodFarming>;

export const GoodType = z.strictObject({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  atomics: GoodAtomics.default({}),
  /**
   * `landscapetype` — the {@link LandscapeType} representing this good as a placed object on the map.
   * Present on every good: a gathered good's equals its {@link GoodGathering.store} stage (`wood`=7), a
   * produced good's is a distinct dropped-good type, a non-landscape good's (vehicle/animal token) is
   * the `void` type (1).
   */
  landscapeType: TypeId.optional(),
  /**
   * The three-stage map-gathering pipeline when this is a raw map-gathered good. Omitted for a produced
   * good. See {@link GoodGathering} and the resolved {@link GatheringPipeline}.
   */
  gathering: GoodGathering.optional(),
  /**
   * The field-cultivation loop parameters when this good is field-farmed (wheat). Omitted otherwise;
   * such a good also carries the plant/cultivate/harvest {@link atomics}. See {@link GoodFarming}.
   */
  farming: GoodFarming.optional(),
  /**
   * Input goods (+ per-cycle amounts) consumed to produce this good, from `goodtypes`
   * `productionInputGoods`. Empty for a raw good. Fills the building `recipe` inputs (the workplace's
   * `produces` names the output; this names what the cycle consumes).
   */
  productionInputs: z.array(ProductionInput).default([]),
  /**
   * The good's node layer in the goods graph, from the `[goodtype]` boolean flags. See
   * {@link GoodClassification}.
   */
  classification: GoodClassification.prefault({}),
  /**
   * The good's character-equipment classification — slot category + whether it wears out. Present only
   * on equippable goods (original ids 30–55: shoes, tools, armour, weapons, mead, potions, amulets);
   * omitted for economy goods. See {@link EquipClass}.
   */
  equip: EquipClass.optional(),
  source: Provenance.optional(),
});
export type GoodType = z.infer<typeof GoodType>;
