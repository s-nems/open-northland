/**
 * Goods logic-type extraction: atomics, classification, production inputs, and gathering rules.
 */
import {
  type GoodAtomics,
  type GoodClassification,
  type GoodGathering,
  GoodType,
  type LandscapeType,
} from '@open-northland/data';
import {
  getInt,
  getIntValues,
  getStr,
  makeSource,
  type RuleSection,
  requireTypeId,
  type SourceRef,
  slug,
  tallyIds,
} from '../grammar.js';

/**
 * Extracts `[goodtype]` sections into validated {@link GoodType} IR. Throws on a section missing the
 * required numeric `type` id — that is malformed source data, surfaced to the human running the
 * offline pipeline rather than silently dropped.
 */
export function extractGoods(sections: readonly RuleSection[], src: SourceRef): GoodType[] {
  const goods: GoodType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'goodtype') continue;
    const typeId = requireTypeId(sec, 'goodtype', src);
    const name = getStr(sec, 'name');
    const gathering = extractGoodGathering(sec);
    goods.push(
      GoodType.parse({
        typeId,
        id: name ? slug(name) : `good_${typeId}`,
        name,
        atomics: extractGoodAtomics(sec),
        productionInputs: extractProductionInputs(sec),
        classification: extractGoodClassification(sec),
        landscapeType: getInt(sec, 'landscapetype'),
        ...(gathering ? { gathering } : {}),
        source: makeSource(src, 'goodtype'),
      }),
    );
  }
  return goods;
}

/**
 * Collapse a `[goodtype]`'s `productionInputGoods` multiset into `{ goodType, amount }` pairs. The
 * line is a flat list of input good ids where a **repeat encodes the quantity** (`… 1 1 14 14 …` =
 * 2× good 1 + 2× good 14), so equal ids are tallied; first-seen order is preserved (deterministic IR).
 * Absent → `[]` (a raw/harvested good with no production recipe). The amounts are faithful counts from
 * the source, not derived.
 */
function extractProductionInputs(sec: RuleSection): { goodType: number; amount: number }[] {
  return tallyIds(getIntValues(sec, 'productionInputGoods'));
}

/**
 * Reads a `[goodtype]`'s boolean classification flags (`1`/`0` ints) onto the node-layer
 * {@link GoodClassification}: `isProducedOnMapFlag` (raw/map-gathered), `isProducedInHouseFlag`
 * (workplace-produced), `isInputGoodFlag` (consumable as a recipe input). An absent flag is `false`.
 * These layers + the `productionInputGoods` edges are the explicit goods-graph IR (raw → produced →
 * food tiers) the Phase-3 economy reads.
 */
function extractGoodClassification(sec: RuleSection): GoodClassification {
  return {
    producedOnMap: getInt(sec, 'isProducedOnMapFlag') === 1,
    producedInHouse: getInt(sec, 'isProducedInHouseFlag') === 1,
    inputGood: getInt(sec, 'isInputGoodFlag') === 1,
  };
}

/**
 * Maps a `[goodtype]`'s `atomicFor*` lines onto the role-keyed {@link GoodAtomics} map. Absent
 * roles are simply omitted (the schema leaves them undefined). The role names match the four keys
 * present in `Data/logic/goodtypes.ini`: Harvesting / Cultivating / Planting / Production.
 */
function extractGoodAtomics(sec: RuleSection): GoodAtomics {
  const atomics: { harvest?: number; cultivate?: number; plant?: number; produce?: number } = {};
  const harvest = getInt(sec, 'atomicForHarvesting');
  const cultivate = getInt(sec, 'atomicForCultivating');
  const plant = getInt(sec, 'atomicForPlanting');
  const produce = getInt(sec, 'atomicForProduction');
  if (harvest !== undefined) atomics.harvest = harvest;
  if (cultivate !== undefined) atomics.cultivate = cultivate;
  if (plant !== undefined) atomics.plant = plant;
  if (produce !== undefined) atomics.produce = produce;
  return atomics;
}

/**
 * Reads a `[goodtype]`'s three-stage gathering pipeline (`landscapeToHarvest`/`landscapeToPickup`/
 * `landscapeToStore` → {@link LandscapeType} ids) + the `isBioLandscapeFlag` classification. Returns
 * `undefined` for a good with NO gathering lane (a produced/in-house good like flour or bread) so the
 * caller omits the field. A partial chain is kept as-is (honey ships only pickup/store, no harvest) —
 * an absent lane is a faithful `undefined`, not a guessed default.
 */
function extractGoodGathering(sec: RuleSection): GoodGathering | undefined {
  const harvest = getInt(sec, 'landscapeToHarvest');
  const pickup = getInt(sec, 'landscapeToPickup');
  const store = getInt(sec, 'landscapeToStore');
  if (harvest === undefined && pickup === undefined && store === undefined) return undefined;
  // `chopsToFell`/`yieldPerNode` are OBSERVED felling calibration constants, NOT in the source `.ini`
  // (verified absent — no `baserepeatcounter` for the collector job), so the extractor emits them at 0
  // (= "not calibrated / single-hit"); a scene/fixture sets the real values, tracked in source basis.
  const gathering: {
    harvest?: number;
    pickup?: number;
    store?: number;
    bioLandscape: boolean;
    chopsToFell: number;
    yieldPerNode: number;
    depositSize: number;
    depositLevels: number;
  } = {
    bioLandscape: getInt(sec, 'isBioLandscapeFlag') === 1,
    // OBSERVED calibration with no readable source (chop count / yield / deposit size — `maximumValency`
    // is a per-cell valency, not the unit count): emitted 0, pinned by a scene until measured. `depositLevels`
    // is DIFFERENT — it IS the harvest `[GfxLandscape]` record's fill-state count (gfx DATA), still emitted 0
    // here (a future join would copy that frame count); until then the spawn site sets it. See source basis.
    chopsToFell: 0,
    yieldPerNode: 0,
    depositSize: 0,
    depositLevels: 0,
  };
  if (harvest !== undefined) gathering.harvest = harvest;
  if (pickup !== undefined) gathering.pickup = pickup;
  if (store !== undefined) gathering.store = store;
  return gathering;
}
