import { type ContentSet, parseContentSet } from '@open-northland/data';
import { testContent } from '../../../fixtures/content.js';
import { WOOD } from './producer-supply/support.js';

// Self-filling houses (the well, the hive), their consumers (bakery, brewery) and utility-good slots on
// the warehouse. A LOCAL content extension, since the shared fixture's typeIds 10..14 are footprinted
// houses the placement tests claim.

export const WATER = 207;
export const BREAD = 208;
export const HONEY = 209;
export const ALE = 210;
export const OPERATOR = 2; // the bakery/brewery craftsman (the fixture's carpenter job, reused as the operator)
export const CARRIER = 24;
export const WELL = 10;
export const HIVE = 11;
export const BAKERY = 12;
export const BREWERY = 13;
export const WAREHOUSE = 7; // testContent's general storage - extended below to stock the utility outputs
export const WELL_PUMP_ATOMIC = 44; // the well's `collectAtomic`
export const HIVE_COLLECT_ATOMIC = 45; // the hive's
export const CONSUMER_CAPACITY = 10;
export const BUILD_MATERIAL = WOOD;

/** testContent extended with the self-filling well and hive, their consumers (bakery, brewery) and
 *  utility-good slots on the warehouse, the storage fallback. */
export function utilityContent(wellCapacity = 1): ContentSet {
  const base = testContent();
  const consumerSlot = (goodType: number) => ({ goodType, capacity: CONSUMER_CAPACITY, input: false });
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WATER, id: 'water', weight: 1 },
      { typeId: BREAD, id: 'bread', weight: 1 },
      { typeId: HONEY, id: 'honey', weight: 1 },
      { typeId: ALE, id: 'ale', weight: 1 },
    ],
    buildings: [
      ...base.buildings.map((b) =>
        b.id === 'warehouse'
          ? {
              ...b,
              stock: [
                ...b.stock,
                { goodType: WATER, capacity: 150, input: false },
                { goodType: BREAD, capacity: 150, input: false },
                { goodType: HONEY, capacity: 150, input: false },
                { goodType: ALE, capacity: 150, input: false },
              ],
            }
          : b,
      ),
      {
        typeId: WELL,
        id: 'work_well_00',
        kind: 'workplace',
        buildOnBioPattern: true,
        collectAtomic: WELL_PUMP_ATOMIC,
        refillsOwnStock: true,
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: WATER, capacity: wellCapacity, input: false }],
        produces: [WATER],
        construction: [{ goodType: BUILD_MATERIAL, amount: 1 }], // so a site stays one until supplied
      },
      {
        typeId: HIVE,
        id: 'work_hive_00',
        kind: 'workplace',
        buildOnBioPattern: true,
        collectAtomic: HIVE_COLLECT_ATOMIC,
        refillsOwnStock: true,
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: HONEY, capacity: 1, input: false }],
        produces: [HONEY],
      },
      {
        typeId: BAKERY,
        id: 'bakery',
        kind: 'workplace',
        workers: [
          { jobType: OPERATOR, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        stock: [consumerSlot(WATER), consumerSlot(BREAD)],
        produces: [BREAD],
        recipes: [
          { inputs: [{ goodType: WATER, amount: 1 }], outputs: [{ goodType: BREAD, amount: 1 }], ticks: 6 },
        ],
      },
      {
        typeId: BREWERY,
        id: 'brewery',
        kind: 'workplace',
        workers: [
          { jobType: OPERATOR, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        stock: [consumerSlot(HONEY), consumerSlot(WATER), consumerSlot(ALE)],
        produces: [ALE],
        recipes: [
          {
            inputs: [
              { goodType: HONEY, amount: 1 },
              { goodType: WATER, amount: 1 },
            ],
            outputs: [{ goodType: ALE, amount: 1 }],
            ticks: 6,
          },
        ],
      },
    ],
  });
}
