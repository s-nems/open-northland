import { AtomicAnimation, TribeType } from '@open-northland/data';
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
        typeId: 30,
        id: 'wardenhall',
        kind: 'storage', // logicmaintype 1
        homeSize: 0,
        workers: [{ jobType: 51, count: 3 }],
        stock: [
          { goodType: 20, capacity: 90, initial: 0 },
          { goodType: 22, capacity: 90, initial: 0 },
        ],
        produces: [],
        construction: [], // build cost is overlaid from the graphics table, not the logic table
        source: src,
      },
      {
        typeId: 31,
        id: 'burrow_nest_00',
        kind: 'home', // logicmaintype 2
        homeSize: 1, // logichomesize
        workers: [],
        stock: [{ goodType: 20, capacity: 4, initial: 1 }],
        produces: [],
        construction: [],
        source: src,
      },
      {
        typeId: 44,
        id: 'grind_lodge_00',
        kind: 'workplace', // logicmaintype 3
        homeSize: 0,
        workers: [{ jobType: 51, count: 1 }],
        stock: [],
        produces: [22, 20], // logicproduction output good ids, in file order
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
  // The goods table carries the input side: guildmark (27) <- productionInputGoods 22 24; dusktonic (31)
  // <- productionInputGoods 20 20 24 24 22 (= 2×good20 + 2×good24 + 1×good22). thornreed (22)/glimmerdew
  // (20) are raw (no inputs). So a workplace producing guildmark should get inputs {thornreed,palegrain},
  // one producing a raw good should get an empty-input recipe (it makes a good with no recipe of its own).
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
  // A minimal reference tribe binding the produce atomics of guildmark (27 -> atomic 70) and dusktonic
  // (31 -> atomic 75) for worker job 5, plus the animations those bindings name with their lengths.
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
    const [mint] = fillBuildingRecipes([building(13, 'mint', [27])], GOODS);
    expect(mint?.recipe).toEqual({
      // guildmark consumes thornreed (22) + palegrain (24), one each — emitted in ascending goodType order.
      inputs: [
        { goodType: 22, amount: 1 },
        { goodType: 24, amount: 1 },
      ],
      outputs: [{ goodType: 27, amount: 1 }],
      ticks: 20,
    });
  });

  it('preserves the repeated-id quantity through the join (dusktonic: 2×20, 2×24, 1×22)', () => {
    const [lab] = fillBuildingRecipes([building(14, 'lab', [31])], GOODS);
    expect(lab?.recipe?.inputs).toEqual([
      { goodType: 20, amount: 2 },
      { goodType: 22, amount: 1 },
      { goodType: 24, amount: 2 },
    ]);
    expect(lab?.recipe?.outputs).toEqual([{ goodType: 31, amount: 1 }]);
  });

  it('merges (sums per input goodType) the inputs of several produced goods', () => {
    const [multi] = fillBuildingRecipes([building(15, 'multi', [27, 31])], GOODS);
    // guildmark needs 22,24; dusktonic needs 20,24,22 -> thornreed(22)=1+1, palegrain(24)=1+2,
    // glimmerdew(20)=2; two outputs.
    expect(multi?.recipe?.inputs).toEqual([
      { goodType: 20, amount: 2 },
      { goodType: 22, amount: 2 },
      { goodType: 24, amount: 3 },
    ]);
    expect(multi?.recipe?.outputs).toEqual([
      { goodType: 27, amount: 1 },
      { goodType: 31, amount: 1 },
    ]);
  });

  it('gives a producer of a raw good an empty-input recipe (still a producer)', () => {
    const [cutter] = fillBuildingRecipes([building(16, 'cutter', [22])], GOODS);
    expect(cutter?.recipe).toEqual({ inputs: [], outputs: [{ goodType: 22, amount: 1 }], ticks: 20 });
  });

  it('leaves a non-producing building (empty produces) with no recipe', () => {
    const [store] = fillBuildingRecipes([building(1, 'hq', [])], GOODS);
    expect(store?.recipe).toBeUndefined();
  });

  it('does not mutate the input building records', () => {
    const input = building(13, 'mint', [27]);
    fillBuildingRecipes([input], GOODS);
    expect(input).not.toHaveProperty('recipe');
  });

  // Recipe `ticks` resolution: worker jobType + produced good's atomicForProduction -> the reference
  // tribe's setatomic animation -> that animation's length. guildmark (27) -> atomic 70; dusktonic (31) -> 75.
  it('resolves recipe.ticks from the produce-atomic animation length via the reference tribe', () => {
    const tribes = [tribe(1, [[5, 70, 'guildmark_forge']])];
    const anims = [anim('guildmark_forge', 80)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [27], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(80);
  });

  it('picks the lowest-typeId tribe as the reference (deterministic, source-order-independent)', () => {
    // Two tribes bind the same (job 5, atomic 70) to different-length animations; tribe 1 wins.
    const tribes = [tribe(3, [[5, 70, 'guildmark_slow']]), tribe(1, [[5, 70, 'guildmark_fast']])];
    const anims = [anim('guildmark_slow', 200), anim('guildmark_fast', 60)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [27], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(60);
  });

  it('falls back to a later output good when the primary output`s produce-atomic does not resolve', () => {
    // produces [27, 31]: guildmark (atomic 70) is unbound; dusktonic (atomic 75) resolves to length 120.
    const tribes = [tribe(1, [[5, 75, 'dusktonic_brew']])];
    const anims = [anim('dusktonic_brew', 120)];
    const [lab] = fillBuildingRecipes(
      [building(15, 'multi', [27, 31], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(lab?.recipe?.ticks).toBe(120);
  });

  it('falls back to the default ticks when no produced good`s produce-atomic resolves a length', () => {
    // Worker present, but no tribe binds (job 5, atomic 70), so the chain breaks -> default 20.
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [27], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 99, 'unrelated']])],
      [anim('unrelated', 10)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when the building has no worker (no jobType to key the binding)', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [27])], // workers: [] -> no jobType
      GOODS,
      [tribe(1, [[5, 70, 'guildmark_forge']])],
      [anim('guildmark_forge', 80)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when tribes/animations are absent (back-compat)', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [27], [{ jobType: 5, count: 1 }])], GOODS);
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('skips an animation of length 0 (not a real cycle) and falls back', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [27], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 70, 'guildmark_zero']])],
      [anim('guildmark_zero', 0)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });
});
