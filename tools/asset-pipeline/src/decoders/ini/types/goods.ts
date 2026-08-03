import {
  type GoodAtomics,
  type GoodClassification,
  type GoodGathering,
  GoodType,
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

function extractProductionInputs(sec: RuleSection): { goodType: number; amount: number }[] {
  return tallyIds(getIntValues(sec, 'productionInputGoods'));
}

function extractGoodClassification(sec: RuleSection): GoodClassification {
  return {
    producedOnMap: getInt(sec, 'isProducedOnMapFlag') === 1,
    producedInHouse: getInt(sec, 'isProducedInHouseFlag') === 1,
    inputGood: getInt(sec, 'isInputGoodFlag') === 1,
  };
}

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

/** A partial chain is kept as-is: an absent lane is a faithful `undefined`, not a guessed default. */
function extractGoodGathering(sec: RuleSection): GoodGathering | undefined {
  const harvest = getInt(sec, 'landscapeToHarvest');
  const pickup = getInt(sec, 'landscapeToPickup');
  const store = getInt(sec, 'landscapeToStore');
  if (harvest === undefined && pickup === undefined && store === undefined) return undefined;
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
    // The `goodtype` record carries none of these four, so the spawn site supplies the real values.
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
