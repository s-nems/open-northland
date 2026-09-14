import type { MapMission } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { type AuthoredJoinRows, resolveMissionScript } from '../src/game/world/index.js';

/**
 * The map-script join: `[MissionData]` lines become typed opcodes with every content name already a
 * numeric typeId, so nothing past this point joins against `ir.json` by name.
 */

const ROWS: AuthoredJoinRows = {
  // The same typeId under two civilizations and two levels, the shape the shipped house table has.
  buildingBobs: [
    { editName: 'viking home', level: 0, typeId: 12, tribeId: 1 },
    { editName: 'viking home', level: 1, typeId: 13, tribeId: 1 },
    { editName: 'frank home', level: 0, typeId: 12, tribeId: 2 },
  ],
  buildings: [{ typeId: 12, id: 'home', kind: 'home' }],
  jobs: [{ typeId: 7, id: 'builder', name: 'builder' }],
  tribes: [
    { typeId: 1, id: 'viking' },
    { typeId: 10, id: 'bear', name: 'brown bears' },
  ],
  animals: [{ tribeType: 10, hitpointsAdult: 15000 }],
  goods: [{ typeId: 4, id: 'wheat', name: 'wheat' }],
  vehicles: [{ typeId: 3, id: 'oxcart', name: 'ox cart' }],
  landscapeGfx: [{ index: 72, editName: 'mist effect' }],
};

function mission(lines: Partial<MapMission>): MapMission {
  return { goals: [], results: [], other: [], ...lines };
}

function goalsOf(...values: string[][]): MapMission[] {
  return [mission({ goals: values.map((v) => ({ key: 'goal', values: v })) })];
}

function resultsOf(...values: string[][]): MapMission[] {
  return [mission({ results: values.map((v) => ({ key: 'result', values: v })) })];
}

describe('resolveMissionScript', () => {
  it('keeps the mission header flags the loader defaults', () => {
    const { script } = resolveMissionScript(
      [mission({ active: true, visible: true, successfullIf: 2 }), mission({})],
      ROWS,
    );
    expect(script.missions).toEqual([
      { successfullIf: 2, active: true, visible: true, goals: [], results: [] },
      { successfullIf: 0, active: false, visible: false, goals: [], results: [] },
    ]);
  });

  it('resolves a landscape EditName to its graphic index and reports missing names', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(
        ['SetLandscape', '10', '20', ' MIST EFFECT ', '3', '1'],
        ['SetLandscape', '10', '20', 'missing effect', '1', '0'],
      ),
      ROWS,
    );
    expect(script.missions[0]?.results).toEqual([
      { opcode: 'SetLandscape', point: { hx: 10, hy: 20 }, landscape: 72, level: 3, flag: true },
      { opcode: 'SetLandscape', point: { hx: 10, hy: 20 }, landscape: -1, level: 1, flag: false },
    ]);
    expect(unresolvedNames).toEqual(['missing effect']);
  });

  it('resolves every name kind to its content typeId', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(
        ['SetHuman', '3', 'viking', 'builder', '10', '20', '105', '0'],
        ['SetVehicle', '1', 'viking', 'ox cart', '5', '6', '7', '1'],
        ['AddGoodsToHouses', '900', 'wheat', '40'],
        ['EnableHouse', '0', 'viking', 'viking home'],
      ),
      ROWS,
    );
    expect(unresolvedNames).toEqual([]);
    expect(script.missions[0]?.results).toEqual([
      {
        opcode: 'SetHuman',
        player: 3,
        tribe: 1,
        job: 7,
        point: { hx: 10, hy: 20 },
        humanId: 105,
        behaviour: 0,
      },
      {
        opcode: 'SetVehicle',
        player: 1,
        tribe: 1,
        vehicleType: 3,
        point: { hx: 5, hy: 6 },
        vehicleId: 7,
        withCaptain: true,
      },
      { opcode: 'AddGoodsToHouses', objectId: 900, good: 4, amount: 40 },
      { opcode: 'EnableHouse', player: 0, tribe: 1, houseType: 12 },
    ]);
  });

  it('resolves a house-instance name with the line`s own level, tribe and all', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(
        ['SetHouse', '1', 'viking home', '1', '0', '30', '40', '9'],
        ['SetHouse', '2', 'frank home', '0', '0', '31', '41', '9'],
      ),
      ROWS,
    );
    expect(unresolvedNames).toEqual([]);
    // The second line takes the same name's other civilization: one typeId belongs to both.
    expect(script.missions[0]?.results).toEqual([
      {
        opcode: 'SetHouse',
        player: 1,
        houseName: { typeId: 13, tribe: 1 },
        level: 1,
        built: false,
        point: { hx: 30, hy: 40 },
        objectId: 9,
      },
      {
        opcode: 'SetHouse',
        player: 2,
        houseName: { typeId: 12, tribe: 2 },
        level: 0,
        built: false,
        point: { hx: 31, hy: 41 },
        objectId: 9,
      },
    ]);
  });

  it('counts a house name no level of the catalog carries', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(['SetHouse', '1', 'viking home', '4', '0', '30', '40', '9']),
      ROWS,
    );
    expect(unresolvedNames).toEqual(['viking home']);
    expect(script.missions[0]?.results[0]).toMatchObject({ houseName: { typeId: -1, tribe: -1 } });
  });

  it('reads an animal species through the same tribe field', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      goalsOf(['CheckNumberOfWildAnimals', 'brown bears', '3']),
      ROWS,
    );
    expect(unresolvedNames).toEqual([]);
    expect(script.missions[0]?.goals).toEqual([{ opcode: 'CheckNumberOfWildAnimals', tribe: 10, amount: 3 }]);
  });

  it('passes through the bare id a script writes where a name belongs', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(['EnableHouse', '0', 'viking', '41']),
      ROWS,
    );
    expect(unresolvedNames).toEqual([]);
    expect(script.missions[0]?.results[0]).toMatchObject({ houseType: 41 });
  });

  it('counts a name the catalog does not know and leaves an id nothing matches', () => {
    const { script, unresolvedNames } = resolveMissionScript(
      resultsOf(['AddGoodsToHouses', '900', 'unobtainium', '40']),
      ROWS,
    );
    expect(unresolvedNames).toEqual(['unobtainium']);
    expect(script.missions[0]?.results[0]).toMatchObject({ good: -1 });
  });

  it('counts the corpus misspellings and short lines the engine loads as no-ops', () => {
    const { script, unknownOpcodes, tokenMismatches } = resolveMissionScript(
      [
        ...goalsOf(['NumberOfHumansNearPos', '100', '65', '45', '3', '1']),
        ...resultsOf(['ActivateMission', '3', '1']),
      ],
      ROWS,
    );
    expect(unknownOpcodes).toBe(1);
    expect(tokenMismatches).toBe(1);
    expect(script.missions[0]?.goals).toEqual([{ opcode: 'True' }]);
    expect(script.missions[1]?.results).toEqual([{ opcode: 'ActivateMission', missionIndex: 3 }]);
  });
});
