import { describe, expect, it } from 'vitest';
import { extractBuildings, parseIniSections } from '../src/decoders/ini.js';
import { HOUSES_INI } from './fixtures/ini-sources.js';

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
        buildOnBioPattern: false,
        canEnableDefenceMode: true, // logicCanEnableDefenceMode 1
        refillsOwnStock: false,
        workers: [{ jobType: 51, count: 3 }],
        stock: [
          { goodType: 20, capacity: 90, initial: 0 },
          { goodType: 22, capacity: 90, initial: 0 },
        ],
        produces: [],
        recipes: [],
        construction: [], // build cost is overlaid from the graphics table, not the logic table
        shelterCapacity: 0, // the garrison size is authored balance, overlaid at the app boundary
        source: src,
      },
      {
        typeId: 31,
        id: 'burrow_nest_00',
        kind: 'home', // logicmaintype 2
        homeSize: 1, // logichomesize
        buildOnBioPattern: false,
        canEnableDefenceMode: false,
        refillsOwnStock: false,
        workers: [],
        stock: [{ goodType: 20, capacity: 4, initial: 1 }],
        produces: [],
        recipes: [],
        construction: [],
        shelterCapacity: 0,
        source: src,
      },
      {
        typeId: 44,
        id: 'grind_lodge_00',
        kind: 'workplace', // logicmaintype 3
        homeSize: 0,
        buildOnBioPattern: true,
        canEnableDefenceMode: false,
        refillsOwnStock: false,
        workers: [{ jobType: 51, count: 1 }],
        stock: [],
        produces: [22, 20], // logicproduction output good ids, in file order
        recipes: [],
        construction: [],
        shelterCapacity: 0,
        source: src,
      },
      {
        typeId: 10,
        id: 'work_well_00',
        kind: 'workplace',
        homeSize: 0,
        buildOnBioPattern: true,
        collectAtomic: 44, // the engine's well pump for logictype 10, not an .ini key
        canEnableDefenceMode: false,
        refillsOwnStock: true, // the engine refills the well's water every game second, no worker needed
        workers: [{ jobType: 51, count: 1 }],
        stock: [{ goodType: 20, capacity: 1, initial: 0 }],
        produces: [20],
        recipes: [],
        construction: [],
        shelterCapacity: 0,
        source: src,
      },
      {
        typeId: 11,
        id: 'work_hive_00',
        kind: 'workplace',
        homeSize: 0,
        buildOnBioPattern: true,
        collectAtomic: 45, // the engine's hive pick-up for logictype 11
        canEnableDefenceMode: false,
        refillsOwnStock: true,
        workers: [{ jobType: 51, count: 1 }],
        stock: [{ goodType: 22, capacity: 1, initial: 0 }],
        produces: [22],
        recipes: [],
        construction: [],
        shelterCapacity: 0,
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
