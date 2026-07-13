import { AtomicAnimation, TribeType } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  extractBuildings,
  extractGoods,
  fillBuildingRecipes,
  parseIniSections,
} from '../src/decoders/ini.js';
import { GOODTYPES_INI, HOUSES_INI } from './fixtures/ini-sources.js';

describe('extractBuildings', () => {
  it('maps [logichousetype] records to validated BuildingType IR (logictype id, debugname slug)', () => {
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), {
      file: 'DataCnmd/types/houses.ini',
      layer: 'mod',
    });
    const src = { file: 'DataCnmd/types/houses.ini', block: 'logichousetype', layer: 'mod' };
    expect(buildings).toEqual([
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'storage', // logicmaintype 1
        homeSize: 0,
        workers: [{ jobType: 5, count: 3 }],
        stock: [
          { goodType: 1, capacity: 150, initial: 0 },
          { goodType: 5, capacity: 150, initial: 0 },
        ],
        produces: [],
        construction: [], // build cost is overlaid from the graphics table, not the logic table
        source: src,
      },
      {
        typeId: 2,
        id: 'home_level_00',
        kind: 'home', // logicmaintype 2
        homeSize: 1, // logichomesize
        workers: [],
        stock: [{ goodType: 1, capacity: 5, initial: 1 }],
        produces: [],
        construction: [],
        source: src,
      },
      {
        typeId: 13,
        id: 'work_mill_00',
        kind: 'workplace', // logicmaintype 3
        homeSize: 0,
        workers: [{ jobType: 5, count: 1 }],
        stock: [],
        produces: [5, 1], // logicproduction output good ids, in file order
        construction: [],
        source: src,
      },
    ]);
  });

  it('throws on a [logichousetype] missing its numeric `logictype`', () => {
    expect(() =>
      extractBuildings(parseIniSections('[logichousetype]\ndebugname "x"\n'), { file: 'f.ini' }),
    ).toThrow(/without a numeric `logictype`/);
  });

  it('maps an unknown logicmaintype to a stable maintype_<n> kind', () => {
    const buildings = extractBuildings(
      parseIniSections('[logichousetype]\ndebugname "weird"\nlogictype 99\nlogicmaintype 9\n'),
      { file: 'f.ini' },
    );
    expect(buildings[0]?.kind).toBe('maintype_9');
  });
});

// Mirrors DataCnmd/budynki12/houses/houses.ini: a `[GfxHouse]` render record whose `LogicType` and
// `LogicConstructionGoods` lines both lead with a *size index* that pairs them, keyed to a tribe by
// `LogicTribeType`. The cost is a flat good-id list where a repeat encodes quantity. A home spans
// several `LogicType` levels (one typeId each), each with its OWN cost; a free building (HQ) has a
// `LogicType` but no construction goods.

describe('fillBuildingRecipes', () => {
  // The goods table carries the input side: coin (8) <- productionInputGoods 5 4; potion (9) <-
  // productionInputGoods 1 1 4 4 5 (= 2×good1 + 2×good4 + 1×good5). wood (5)/water (1) are raw (no
  // inputs). So a workplace producing coin should get inputs {wood,wheat}, one producing a raw good
  // should get an empty-input recipe (it makes a good with no recipe of its own).
  const GOODS = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
  const src = { file: 'houses.ini', block: 'logichousetype', layer: 'mod' as const };
  const building = (
    typeId: number,
    id: string,
    produces: number[],
    workers: { jobType: number; count: number }[] = [],
  ) => ({
    typeId,
    id,
    kind: 'workplace',
    homeSize: 0,
    workers,
    stock: [],
    produces,
    source: src,
  });
  // A minimal reference tribe binding the produce atomics of coin (8 -> atomic 51) and potion
  // (9 -> atomic 73) for worker job 5, plus the animations those bindings name with their lengths.
  const tribe = (typeId: number, bindings: [number, number, string][]) =>
    TribeType.parse({
      typeId,
      id: `tribe_${typeId}`,
      atomicBindings: bindings.map(([jobType, atomicId, animation]) => ({
        jobType,
        atomicId,
        animation,
      })),
      source: src,
    });
  const anim = (name: string, length: number) =>
    AtomicAnimation.parse({ id: name, name, length, source: src });

  it('joins a workplace output good -> that good`s productionInputs into recipe.inputs', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [8])], GOODS);
    expect(mint?.recipe).toEqual({
      // coin consumes wood (5) + wheat (4), one each — emitted in ascending input-goodType order.
      inputs: [
        { goodType: 4, amount: 1 },
        { goodType: 5, amount: 1 },
      ],
      outputs: [{ goodType: 8, amount: 1 }],
      ticks: 20,
    });
  });

  it('preserves the repeated-id quantity through the join (potion: 2×1, 2×4, 1×5)', () => {
    const [lab] = fillBuildingRecipes([building(14, 'lab', [9])], GOODS);
    expect(lab?.recipe?.inputs).toEqual([
      { goodType: 1, amount: 2 },
      { goodType: 4, amount: 2 },
      { goodType: 5, amount: 1 },
    ]);
    expect(lab?.recipe?.outputs).toEqual([{ goodType: 9, amount: 1 }]);
  });

  it('merges (sums per input goodType) the inputs of several produced goods', () => {
    const [multi] = fillBuildingRecipes([building(15, 'multi', [8, 9])], GOODS);
    // coin needs 5,4; potion needs 1,4,5 -> wood(5)=1+1, wheat(4)=1+2, water(1)=2; two outputs.
    expect(multi?.recipe?.inputs).toEqual([
      { goodType: 1, amount: 2 },
      { goodType: 4, amount: 3 },
      { goodType: 5, amount: 2 },
    ]);
    expect(multi?.recipe?.outputs).toEqual([
      { goodType: 8, amount: 1 },
      { goodType: 9, amount: 1 },
    ]);
  });

  it('gives a producer of a raw good an empty-input recipe (still a producer)', () => {
    const [cutter] = fillBuildingRecipes([building(16, 'cutter', [5])], GOODS);
    expect(cutter?.recipe).toEqual({ inputs: [], outputs: [{ goodType: 5, amount: 1 }], ticks: 20 });
  });

  it('leaves a non-producing building (empty produces) with no recipe', () => {
    const [store] = fillBuildingRecipes([building(1, 'hq', [])], GOODS);
    expect(store?.recipe).toBeUndefined();
  });

  it('does not mutate the input building records', () => {
    const input = building(13, 'mint', [8]);
    fillBuildingRecipes([input], GOODS);
    expect(input).not.toHaveProperty('recipe');
  });

  // Recipe `ticks` resolution: worker jobType + produced good's atomicForProduction -> the reference
  // tribe's setatomic animation -> that animation's length. coin (8) -> atomic 51; potion (9) -> 73.
  it('resolves recipe.ticks from the produce-atomic animation length via the reference tribe', () => {
    const tribes = [tribe(1, [[5, 51, 'coin_produce']])];
    const anims = [anim('coin_produce', 80)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(80);
  });

  it('picks the lowest-typeId tribe as the reference (deterministic, source-order-independent)', () => {
    // Two tribes bind the same (job 5, atomic 51) to different-length animations; tribe 1 wins.
    const tribes = [tribe(3, [[5, 51, 'coin_slow']]), tribe(1, [[5, 51, 'coin_fast']])];
    const anims = [anim('coin_slow', 200), anim('coin_fast', 60)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(60);
  });

  it('falls back to a later output good when the primary output`s produce-atomic does not resolve', () => {
    // produces [8, 9]: coin (atomic 51) is unbound; potion (atomic 73) resolves to length 120.
    const tribes = [tribe(1, [[5, 73, 'potion_produce']])];
    const anims = [anim('potion_produce', 120)];
    const [lab] = fillBuildingRecipes(
      [building(15, 'multi', [8, 9], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(lab?.recipe?.ticks).toBe(120);
  });

  it('falls back to the default ticks when no produced good`s produce-atomic resolves a length', () => {
    // Worker present, but no tribe binds (job 5, atomic 51), so the chain breaks -> default 20.
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 99, 'unrelated']])],
      [anim('unrelated', 10)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when the building has no worker (no jobType to key the binding)', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8])], // workers: [] -> no jobType
      GOODS,
      [tribe(1, [[5, 51, 'coin_produce']])],
      [anim('coin_produce', 80)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when tribes/animations are absent (back-compat)', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [8], [{ jobType: 5, count: 1 }])], GOODS);
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('skips an animation of length 0 (not a real cycle) and falls back', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 51, 'coin_zero']])],
      [anim('coin_zero', 0)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });
});
