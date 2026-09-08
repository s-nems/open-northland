import { z } from 'zod';
import { EquipClass } from '../actors/equipment.js';
import { AtomicId, Provenance, TypeId } from '../record.js';

/**
 * Atomic ids that act on a good, keyed by role (`goodtypes` `atomicFor*`). The good is the atomic's
 * object: `harvest` takes it from the map, `plant`/`cultivate` grow it, `produce` makes it.
 */
export const GoodAtomics = z.strictObject({
  harvest: AtomicId.optional(),
  cultivate: AtomicId.optional(),
  plant: AtomicId.optional(),
  produce: AtomicId.optional(),
});
export type GoodAtomics = z.infer<typeof GoodAtomics>;

/**
 * A good paired with a positive per-cycle quantity. Every source encodes these as a flat id list where a
 * repeated id is the amount (`… 1 1 14 14 …` = 2×good1 + 2×good14), collapsed here in first-seen order.
 */
export const GoodQuantity = z.strictObject({
  goodType: TypeId,
  amount: z.number().int().positive(),
});
export type GoodQuantity = z.infer<typeof GoodQuantity>;

export const ProductionInput = GoodQuantity;
export type ProductionInput = GoodQuantity;

/**
 * The `[goodtype]` boolean flags. Not exclusive: a produced good can also be a recipe input.
 */
export const GoodClassification = z.strictObject({
  /** `isProducedOnMapFlag` - a raw good gathered from the map. */
  producedOnMap: z.boolean().default(false),
  /** `isProducedInHouseFlag` - a good produced in a workplace. */
  producedInHouse: z.boolean().default(false),
  /** `isInputGoodFlag` - consumable as an input by some production recipe. */
  inputGood: z.boolean().default(false),
});
export type GoodClassification = z.infer<typeof GoodClassification>;

/**
 * A raw good's three-stage gathering chain from the `[goodtype]` `landscapeTo*` fields: the
 * {@link LandscapeType} states a cell passes through, `tree(4) → trunk(6) → wood(7)`. An absent stage
 * means the source omits that lane (honey has no {@link harvest}).
 */
export const GoodGathering = z.strictObject({
  /** `landscapeToHarvest` - the source landscape a settler works (a `tree`/`rock`/`mine`). */
  harvest: TypeId.optional(),
  /** `landscapeToPickup` - the intermediate the harvested cell becomes (a `trunk`/`ore`). */
  pickup: TypeId.optional(),
  /** `landscapeToStore` - the finished good resting on the ground before it is stocked. */
  store: TypeId.optional(),
  /** `isBioLandscapeFlag` - living/growing landscapes (trees, herb) vs mined (stone, ore). */
  bioLandscape: z.boolean().default(false),
  /**
   * Observed calibration, not extracted (the readable `.ini` has no collector-job `baserepeatcounter`):
   * chop atomics needed to fell a standing node before it drops its whole yield as a ground trunk. `0`
   * (the extractor default) is a single-hit gather like stone; `> 0` a fell-once-whole-yield good.
   */
  chopsToFell: z.number().int().nonnegative().default(0),
  /**
   * Observed calibration - units a felled node drops as its ground trunk. Only meaningful when
   * {@link chopsToFell} `> 0`; `0` leaves the amount to the spawn site.
   */
  yieldPerNode: z.number().int().nonnegative().default(0),
  /**
   * Observed calibration - fallback units a mined deposit holds for a spawn with no `[GfxLandscape]`
   * record behind it. No readable per-good field pins it: `landscapetypes.ini` `maximumValency` is a
   * per-cell valency, not the per-record `[GfxLandscape]` `LogicMaximumValency` that sizes a decoded
   * map's placements. `> 0` marks a mined good; `0` (the extractor default) means not mined.
   */
  depositSize: z.number().int().nonnegative().default(0),
  /**
   * Discrete fill states a mined deposit steps down through as it empties: the harvest `[GfxLandscape]`
   * record's own state count, which the extractor does not yet join, so `0` leaves it to the spawn site.
   */
  depositLevels: z.number().int().nonnegative().default(0),
});
export type GoodGathering = z.infer<typeof GoodGathering>;

/**
 * A field-farmed good's sow, water and reap parameters (wheat), distinct from {@link GoodGathering}.
 * The original wires the loop's vocabulary in readable data (`goodtypes.ini` wheat
 * `atomicForPlanting 34`/`atomicForCultivating 35`/`atomicForHarvesting 29`, `landscapetypes.ini`
 * 27/28/29 = growing/harvested/pile) but not its field area, so every number except {@link stages} is a
 * calibration constant.
 */
export const GoodFarming = z.strictObject({
  /** Growth stages a sown field passes before ripe. Extracted, not observed: `landscapetypes.ini` wheat
   *  (growing) `maximumValency 5`, matching the `[GfxLandscape]` record's 5 growth frames. */
  stages: z.number().int().positive(),
  /** Units a ripe field drops (as a ground sheaf) when reaped. */
  yieldPerField: z.number().int().positive(),
  /** How far from the farm's anchor its workers sow, in half-cell nodes. */
  fieldRadius: z.number().int().positive(),
  /** Fields one farm keeps standing at once, whatever its crew size. */
  maxFields: z.number().int().positive(),
});
export type GoodFarming = z.infer<typeof GoodFarming>;

export const GoodType = z.strictObject({
  typeId: TypeId,
  id: z.string(), // human-readable slug, e.g. "wood"
  name: z.string().optional(),
  weight: z.number().default(0),
  atomics: GoodAtomics.default({}),
  /**
   * `landscapetype` - the {@link LandscapeType} representing this good as a placed object on the map.
   * Present on every good: a gathered good's equals its {@link GoodGathering.store} stage (`wood`=7), a
   * produced good's is a distinct dropped-good type, and a good with no map form (vehicle/animal token)
   * carries the `void` type (1).
   */
  landscapeType: TypeId.optional(),
  /** The map-gathering pipeline when this is a raw map-gathered good; omitted for a produced good. */
  gathering: GoodGathering.optional(),
  /** Field-cultivation parameters when this good is field-farmed (wheat); such a good also carries the
   *  plant/cultivate/harvest {@link atomics}. */
  farming: GoodFarming.optional(),
  /** Input goods and per-cycle amounts consumed to produce this good (`goodtypes`
   *  `productionInputGoods`); empty for a raw good. */
  productionInputs: z.array(ProductionInput).default([]),
  classification: GoodClassification.prefault({}),
  /** Present only on equippable goods (original ids 30-55: shoes, tools, armour, weapons, mead, potions,
   *  amulets); omitted for economy goods. */
  equip: EquipClass.optional(),
  source: Provenance.optional(),
});
export type GoodType = z.infer<typeof GoodType>;

/**
 * Whether a good is grown on the map rather than gathered or manufactured indoors. The signal is the
 * three cultivation atomics present together (`atomicForPlanting`/`Cultivating`/`Harvesting`), which
 * wheat, herb, and mushroom carry.
 */
export function hasFieldFarmAtomics(good: GoodType): boolean {
  const { plant, cultivate, harvest } = good.atomics;
  return plant !== undefined && cultivate !== undefined && harvest !== undefined;
}
