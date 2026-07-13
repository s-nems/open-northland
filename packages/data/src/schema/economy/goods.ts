import { z } from 'zod';
import { EquipClass } from '../actors/equipment.js';
import { AtomicId, Provenance, TypeId } from '../record.js';

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
 * One input good consumed to produce this good — the *input side* of the goods graph, keyed by the
 * **output** good (the good being made). A semantic alias of {@link GoodQuantity} (same shape), kept
 * as its own name for the good's `productionInputs` field and its sim consumers.
 */
export const ProductionInput = GoodQuantity;
export type ProductionInput = GoodQuantity;

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

/**
 * A FIELD-FARMED good's cultivation parameters (wheat) — the sow→grow→water→reap loop a farm's worker
 * runs on map fields, distinct from {@link GoodGathering}'s harvest-a-standing-node pipeline. The
 * original wires the loop's VOCABULARY in readable data (`goodtypes.ini` wheat: `atomicForPlanting 34`,
 * `atomicForCultivating 35`, `atomicForHarvesting 29`, `isProducedOnMapFlag 1`; `landscapetypes.ini`
 * 27/28/29 = wheat growing/harvested/pile) but the loop's TIMINGS and the farm's field area live in the
 * native engine, so every numeric here except {@link stages} is an OBSERVED calibration constant the
 * content set pins (the app's `catalog/farming.ts` carries the named calibration and its rationale).
 */
export const GoodFarming = z.strictObject({
  /**
   * Growth stages a sown field passes through before it is ripe. DATA, not observed: the growing
   * landscape's own state count (`landscapetypes.ini` wheat(growing) `maximumValency 5`, matching the
   * `[GfxLandscape]` record's 5 growth frames the render steps through).
   */
  stages: z.number().int().positive(),
  /** OBSERVED — ticks an unwatered field takes to advance one growth stage (no readable growth timing). */
  ticksPerStage: z.number().int().positive(),
  /** OBSERVED — units a ripe field drops (as a ground sheaf) when reaped. The only related readable
   *  number is `humanjobexperiencetypes.ini` "farmer wheat" `baserepeatcounter 2` (semantics unpinned). */
  yieldPerField: z.number().int().positive(),
  /** OBSERVED — how far from the farm's anchor its workers sow, in half-cell NODES (no radius in data). */
  fieldRadius: z.number().int().positive(),
  /** OBSERVED — the crew-independent part of a farm's field cap. The live cap is
   *  `fieldsBase + fieldsPerFarmer × bound field-farmers`, so the plot grows SUBLINEARLY with the
   *  crew (user-directed calibration: one farmer works 6 fields, a pair 10 — not 12). Defaults to 0
   *  (pure per-farmer scaling) so a content set without the knob reads unchanged. */
  fieldsBase: z.number().int().nonnegative().default(0),
  /** OBSERVED — the per-farmer slope of the field cap (see {@link fieldsBase}; no field-count in data). */
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
   * The field-cultivation loop parameters, when this good is FIELD-FARMED (sown/watered/reaped on map
   * fields by a farm's worker — wheat). Omitted for every other good; a good with `farming` should also
   * carry the plant/cultivate/harvest {@link atomics} the loop's actions run. See {@link GoodFarming}.
   */
  farming: GoodFarming.optional(),
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
  classification: GoodClassification.prefault({}),
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
