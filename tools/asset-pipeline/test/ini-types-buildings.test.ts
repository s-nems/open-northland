import { BuildingType, DEFAULT_RECIPE_TICKS, VehicleType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  extractBuildings,
  extractGoods,
  fillBuildingRecipes,
  parseIniSections,
  stripVehicleGoods,
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
        recipes: [],
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
        recipes: [],
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
        recipes: [],
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

describe('fillBuildingRecipes', () => {
  // The goods table carries the input side: guildmark (27) <- productionInputGoods 22 24; dusktonic (31)
  // <- productionInputGoods 20 20 24 24 22 (= 2×good20 + 2×good24 + 1×good22). thornreed (22)/glimmerdew
  // (20) are raw (no inputs). So a workplace producing guildmark should get a guildmark recipe with
  // inputs {thornreed,palegrain}; one producing a raw good an empty-input recipe (still a producer).
  const GOODS = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
  const src = { file: 'houses.ini', block: 'logichousetype', layer: 'mod' as const };
  const building = (typeId: number, id: string, produces: number[]) =>
    BuildingType.parse({ typeId, id, kind: 'workplace', produces, source: src });

  it('joins a workplace output good -> that good`s productionInputs into the product recipe', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [27])], GOODS);
    expect(mint?.recipes).toEqual([
      {
        // guildmark consumes thornreed (22) + palegrain (24), one each — ascending goodType order.
        inputs: [
          { goodType: 22, amount: 1 },
          { goodType: 24, amount: 1 },
        ],
        outputs: [{ goodType: 27, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ]);
  });

  it('preserves the repeated-input quantity through the join (dusktonic: 2×20, 2×24, 1×22)', () => {
    const [lab] = fillBuildingRecipes([building(14, 'lab', [31])], GOODS);
    expect(lab?.recipes[0]?.inputs).toEqual([
      { goodType: 20, amount: 2 },
      { goodType: 22, amount: 1 },
      { goodType: 24, amount: 2 },
    ]);
    expect(lab?.recipes[0]?.outputs).toEqual([{ goodType: 31, amount: 1 }]);
  });

  it('emits one recipe PER produced good, each with only its own inputs, in produces order', () => {
    const [multi] = fillBuildingRecipes([building(15, 'multi', [27, 31])], GOODS);
    expect(multi?.recipes).toEqual([
      {
        inputs: [
          { goodType: 22, amount: 1 },
          { goodType: 24, amount: 1 },
        ],
        outputs: [{ goodType: 27, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [
          { goodType: 20, amount: 2 },
          { goodType: 22, amount: 1 },
          { goodType: 24, amount: 2 },
        ],
        outputs: [{ goodType: 31, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ]);
  });

  it('sums a repeated logicproduction id into one recipe`s output amount', () => {
    const [twin] = fillBuildingRecipes([building(18, 'twin', [22, 22])], GOODS);
    expect(twin?.recipes).toEqual([
      { inputs: [], outputs: [{ goodType: 22, amount: 2 }], ticks: DEFAULT_RECIPE_TICKS },
    ]);
  });

  it('gives a producer of a raw good an empty-input recipe (still a producer)', () => {
    const [cutter] = fillBuildingRecipes([building(16, 'cutter', [22])], GOODS);
    expect(cutter?.recipes).toEqual([
      { inputs: [], outputs: [{ goodType: 22, amount: 1 }], ticks: DEFAULT_RECIPE_TICKS },
    ]);
  });

  it('leaves a non-producing building (empty produces) with no recipes', () => {
    const [store] = fillBuildingRecipes([building(1, 'hq', [])], GOODS);
    expect(store?.recipes).toEqual([]);
  });

  it('gives no recipes to a workplace whose only output is field-farmed (grown, not made)', () => {
    // palegrain (24) carries all three field atomics (plant 64 / cultivate 63 / harvest 62) → grown on
    // the map, so a farm producing only it forms no in-house recipe (the sim field-farms it instead).
    const [farm] = fillBuildingRecipes([building(12, 'farm', [24])], GOODS);
    expect(farm?.recipes).toEqual([]);
  });

  it('drops only the field-farmed output when a workplace also makes a manufactured good', () => {
    // produces [24, 27]: palegrain (24) is field-grown and excluded; guildmark (27) stays, so the
    // recipe list is guildmark alone — with its own inputs thornreed (22) + palegrain (24), a field
    // good being a valid recipe *input* even though it is never a synthesized *output*.
    const [mixed] = fillBuildingRecipes([building(17, 'mixed', [24, 27])], GOODS);
    expect(mixed?.recipes).toHaveLength(1);
    expect(mixed?.recipes[0]?.outputs).toEqual([{ goodType: 27, amount: 1 }]);
    expect(mixed?.recipes[0]?.inputs).toEqual([
      { goodType: 22, amount: 1 },
      { goodType: 24, amount: 1 },
    ]);
  });

  it('does not mutate the input building records', () => {
    const input = building(13, 'mint', [27]);
    fillBuildingRecipes([input], GOODS);
    expect(input.recipes).toEqual([]);
  });

  it('paces every recipe at the uniform design ticks (15 s at 1×)', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [27])], GOODS);
    expect(mint?.recipes[0]?.ticks).toBe(DEFAULT_RECIPE_TICKS);
    expect(DEFAULT_RECIPE_TICKS).toBe(180); // 15 s × the sim's 12 ticks/s
  });
});

describe('stripVehicleGoods', () => {
  const GOODS = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
  const src = { file: 'houses.ini', block: 'logichousetype', layer: 'mod' as const };
  // 'guildmark' (27) doubles as a vehicle here — the strip keys on the goodtype↔vehicletype slug
  // identity, exactly how the real data links handcart/oxcart/ships/catapult.
  const cartVehicle = VehicleType.parse({ typeId: 1, id: 'guildmark' });

  it('drops a vehicle good from stock and produces, so the recipe join never materializes it', () => {
    const workshop = BuildingType.parse({
      typeId: 40,
      id: 'wainwright',
      kind: 'workplace',
      produces: [27, 31],
      stock: [
        { goodType: 22, capacity: 10, initial: 0 },
        { goodType: 27, capacity: 5, initial: 0 },
      ],
      source: src,
    });
    const [stripped] = stripVehicleGoods([workshop], GOODS, [cartVehicle]);
    expect(stripped?.stock.map((s) => s.goodType)).toEqual([22]);
    expect(stripped?.produces).toEqual([31]);
    const [filled] = fillBuildingRecipes([stripped ?? workshop], GOODS);
    expect(filled?.recipes.flatMap((r) => r.outputs.map((o) => o.goodType))).toEqual([31]);
  });

  it('leaves buildings untouched when no good shares a vehicle slug', () => {
    const workshop = BuildingType.parse({
      typeId: 41,
      id: 'plain',
      kind: 'workplace',
      produces: [31],
      source: src,
    });
    const [same] = stripVehicleGoods([workshop], GOODS, [VehicleType.parse({ typeId: 2, id: 'sled' })]);
    expect(same).toBe(workshop); // identity preserved — nothing to strip
  });
});
