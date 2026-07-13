import { describe, expect, it } from 'vitest';
import { extractGoods, parseIniSections } from '../src/decoders/ini.js';
import { GOODTYPES_INI } from './fixtures/ini-sources.js';

describe('extractGoods', () => {
  it('maps [goodtype] sections to validated GoodType IR with slug ids and provenance', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), {
      file: 'Data/logic/goodtypes.ini',
    });
    const src = { file: 'Data/logic/goodtypes.ini', block: 'goodtype', layer: 'base' };
    const noClass = { producedOnMap: false, producedInHouse: false, inputGood: false };
    expect(goods).toEqual([
      {
        typeId: 1,
        id: 'water',
        name: 'water',
        weight: 0,
        atomics: {},
        productionInputs: [],
        // `isInputGoodFlag 1` only — a raw input good neither produced on-map nor in-house here.
        classification: { producedOnMap: false, producedInHouse: false, inputGood: true },
        // `landscapetype 3` present, but no `landscapeTo*` chain -> no `gathering` (water is not gathered).
        landscapeType: 3,
        source: src,
      },
      {
        typeId: 5,
        id: 'wood',
        name: 'wood',
        weight: 0,
        atomics: { harvest: 24 },
        productionInputs: [],
        // a raw good gathered from the map that is also a recipe input.
        classification: { producedOnMap: true, producedInHouse: false, inputGood: true },
        landscapeType: 7,
        // the three-stage pipeline: tree(4) -> trunk(6) -> wood(7); `isBioLandscapeFlag 1` -> bio. The
        // felling/mining params (chops/yield/deposit) are OBSERVED, absent from the source → extractor emits 0.
        gathering: {
          harvest: 4,
          pickup: 6,
          store: 7,
          bioLandscape: true,
          chopsToFell: 0,
          yieldPerNode: 0,
          depositSize: 0,
          depositLevels: 0,
        },
        source: src,
      },
      {
        typeId: 4,
        id: 'wheat',
        name: 'wheat',
        weight: 0,
        atomics: { harvest: 29, cultivate: 35, plant: 34 },
        productionInputs: [],
        classification: { producedOnMap: true, producedInHouse: false, inputGood: true },
        source: src,
      },
      {
        typeId: 8,
        id: 'coin',
        name: 'coin',
        weight: 0,
        atomics: { produce: 51 },
        // `productionInputGoods 5 4` — one each of wood + wheat (distinct ids, amount 1).
        productionInputs: [
          { goodType: 5, amount: 1 },
          { goodType: 4, amount: 1 },
        ],
        // a produced (in-house) good — the output layer of the goods graph.
        classification: { producedOnMap: false, producedInHouse: true, inputGood: false },
        source: src,
      },
      {
        typeId: 9,
        id: 'potion',
        name: 'potion',
        weight: 0,
        atomics: { produce: 73 },
        // `productionInputGoods 1 1 4 4 5` — a repeated id is the quantity (2× good1, 2× good4, 1× good5),
        // collapsed to a multiset in first-seen order.
        productionInputs: [
          { goodType: 1, amount: 2 },
          { goodType: 4, amount: 2 },
          { goodType: 5, amount: 1 },
        ],
        // no classification flags in the fixture — all default false.
        classification: noClass,
        source: src,
      },
    ]);
  });

  it('throws on a [goodtype] missing its numeric `type`', () => {
    expect(() => extractGoods(parseIniSections('[goodtype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });

  it('captures a partial gathering chain + bioLandscape verbatim (honey ships no landscapeToHarvest)', () => {
    const [honey] = extractGoods(
      parseIniSections(
        '[goodtype]\nname "honey"\ntype 12\nlandscapetype 32\nisBioLandscapeFlag 0\nlandscapeToPickup 32\nlandscapeToStore 32\n',
      ),
      { file: 'goodtypes.ini' },
    );
    expect(honey?.landscapeType).toBe(32);
    // The absent harvest lane stays undefined — a faithful omission, not a guessed default. The felling/
    // mining params (chops/yield/deposit) are OBSERVED, absent from the source, so the extractor emits 0.
    expect(honey?.gathering).toEqual({
      pickup: 32,
      store: 32,
      bioLandscape: false,
      chopsToFell: 0,
      yieldPerNode: 0,
      depositSize: 0,
      depositLevels: 0,
    });
  });

  it('omits `gathering` for a produced good with no landscapeTo* chain (keeps its landscapeType)', () => {
    const [flour] = extractGoods(
      parseIniSections('[goodtype]\nname "flour"\ntype 11\nlandscapetype 30\nisProducedInHouseFlag 1\n'),
      { file: 'goodtypes.ini' },
    );
    expect(flour?.landscapeType).toBe(30);
    expect(flour?.gathering).toBeUndefined();
  });
});
