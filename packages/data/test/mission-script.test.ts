import { describe, expect, it } from 'vitest';
import {
  decodeMissionGoal,
  decodeMissionResult,
  MISSION_GOALS,
  MISSION_PARAMS,
  MISSION_RESULTS,
  type MissionDecodeWarning,
  type MissionParamKind,
} from '../src/index.js';

function goal(...values: string[]): ReturnType<typeof decodeMissionGoal> {
  return decodeMissionGoal({ key: 'goal', values });
}

function result(...values: string[]): ReturnType<typeof decodeMissionResult> {
  return decodeMissionResult({ key: 'result', values });
}

function warningsOf(decode: (warn: (w: MissionDecodeWarning) => void) => void): MissionDecodeWarning[] {
  const seen: MissionDecodeWarning[] = [];
  decode((w) => seen.push(w));
  return seen;
}

/** The opcodes the kind cases below decode, and with them the coverage claim this suite makes. */
const KIND_CASE_OPCODES = [
  'SetHuman',
  'SetVehicle',
  'SetHouse',
  'SetLandscape',
  'AddGoodsToHouses',
  'ExploreArea',
  'SetDiplomacy',
  'FindHumansByHumans',
  'FindVehiclesByVehicles',
  'BuildHouses',
  'ActivateMission',
  'StartSubMission',
  'SetExternalFlag',
  'PlaySound',
  'SetHumanName',
  'ClearTribute',
  'PlayCutscene',
  'TimeGone',
  'SetHouseBehaviourFlag',
  'MoveUnitsInArea',
] as const;

describe('the mission opcode tables', () => {
  it('holds the original table sizes with unique, case-insensitively distinct names', () => {
    expect(MISSION_GOALS.length).toBe(63);
    expect(MISSION_RESULTS.length).toBe(103);
    for (const rows of [MISSION_GOALS, MISSION_RESULTS]) {
      const names = rows.map((row) => row[0].toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('gives every parameter of an opcode its own field, so no signature loses one', () => {
    for (const [name, ...params] of [...MISSION_GOALS, ...MISSION_RESULTS]) {
      const fields = params.map((kind) => MISSION_PARAMS[kind].field);
      expect(`${name}: ${new Set(fields).size}`).toBe(`${name}: ${fields.length}`);
    }
  });

  it('exercises every parameter kind in the cases below', () => {
    const byName = new Map([...MISSION_GOALS, ...MISSION_RESULTS].map((row) => [row[0], row]));
    const covered = new Set<MissionParamKind>();
    for (const name of KIND_CASE_OPCODES) {
      const [, ...params] = byName.get(name) ?? [];
      for (const kind of params) covered.add(kind);
    }
    expect([...covered].sort()).toEqual(Object.keys(MISSION_PARAMS).sort());
  });
});

describe('decoding a mission line', () => {
  it('reads ids, names, points, amounts and flags off the declared signature', () => {
    expect(result('SetHuman', '3', 'viking', 'carrier', '10', '20', '105', '16937')).toEqual({
      opcode: 'SetHuman',
      player: 3,
      tribe: { ref: 'name', name: 'viking' },
      job: { ref: 'name', name: 'carrier' },
      point: { hx: 10, hy: 20 },
      humanId: 105,
      behaviour: 16937,
    });
    expect(result('SetVehicle', '1', 'viking', 'catapult', '5', '6', '7', '1')).toEqual({
      opcode: 'SetVehicle',
      player: 1,
      tribe: { ref: 'name', name: 'viking' },
      vehicleType: { ref: 'name', name: 'catapult' },
      point: { hx: 5, hy: 6 },
      vehicleId: 7,
      withCaptain: true,
    });
    expect(result('SetHouse', '0', 'viking stock', '1', '0', '64', '184', '911')).toEqual({
      opcode: 'SetHouse',
      player: 0,
      houseName: 'viking stock',
      level: 1,
      built: false,
      point: { hx: 64, hy: 184 },
      objectId: 911,
    });
    expect(result('SetLandscape', '12', '13', 'fx wave', '2', '1')).toEqual({
      opcode: 'SetLandscape',
      point: { hx: 12, hy: 13 },
      landscape: 'fx wave',
      level: 2,
      flag: true,
    });
    expect(result('AddGoodsToHouses', '900', 'wood', '40')).toEqual({
      opcode: 'AddGoodsToHouses',
      objectId: 900,
      good: { ref: 'name', name: 'wood' },
      amount: 40,
    });
    expect(result('ExploreArea', '0', '30', '40', '25')).toEqual({
      opcode: 'ExploreArea',
      player: 0,
      point: { hx: 30, hy: 40 },
      range: 25,
    });
    expect(result('SetDiplomacy', '4', '0', 'friend')).toEqual({
      opcode: 'SetDiplomacy',
      player: 4,
      otherPlayer: 0,
      state: 'friend',
    });
    expect(result('SetExternalFlag', '2', '7', '1')).toEqual({
      opcode: 'SetExternalFlag',
      player: 2,
      flagId: 7,
      flag: true,
    });
    expect(result('PlaySound', '63', '143', '66')).toEqual({
      opcode: 'PlaySound',
      sound: 63,
      point: { hx: 143, hy: 66 },
    });
    expect(result('SetHumanName', '100', '412')).toEqual({
      opcode: 'SetHumanName',
      humanId: 100,
      stringId: 412,
    });
    expect(result('ClearTribute', '12')).toEqual({ opcode: 'ClearTribute', slot: 12 });
    expect(result('PlayCutscene', '1004', '1')).toEqual({
      opcode: 'PlayCutscene',
      cutscene: 1004,
      replay: true,
    });
    expect(result('ActivateMission', '17')).toEqual({ opcode: 'ActivateMission', missionIndex: 17 });
    expect(result('StartSubMission', '2', '5')).toEqual({
      opcode: 'StartSubMission',
      campaignId: 2,
      mapId: 5,
    });
    expect(result('SetHouseBehaviourFlag', '905', '3', '1')).toEqual({
      opcode: 'SetHouseBehaviourFlag',
      objectId: 905,
      index: 3,
      flag: true,
    });
    expect(result('MoveUnitsInArea', '0', '10', '11', '6', '80', '90')).toEqual({
      opcode: 'MoveUnitsInArea',
      player: 0,
      point: { hx: 10, hy: 11 },
      range: 6,
      index: 80,
      extra: 90,
    });
    expect(goal('TimeGone', '30')).toEqual({ opcode: 'TimeGone', seconds: 30 });
    expect(goal('BuildHouses', '0', 'viking home', '3', '0')).toEqual({
      opcode: 'BuildHouses',
      player: 0,
      houseType: { ref: 'name', name: 'viking home' },
      amount: 3,
      objectId: 0,
    });
    expect(goal('FindHumansByHumans', '100', '200', '8')).toEqual({
      opcode: 'FindHumansByHumans',
      humanId: 100,
      otherHumanId: 200,
      range: 8,
    });
    expect(goal('FindVehiclesByVehicles', '10', '11', '4')).toEqual({
      opcode: 'FindVehiclesByVehicles',
      vehicleId: 10,
      otherVehicleId: 11,
      range: 4,
    });
  });

  it('keeps the numeric id a script writes where a name belongs', () => {
    expect(result('EnableHouse', '0', 'viking', '41')).toEqual({
      opcode: 'EnableHouse',
      player: 0,
      tribe: { ref: 'name', name: 'viking' },
      houseType: { ref: 'id', id: 41 },
    });
  });

  it('reads a diplomacy state by name or by its DIPLOMACY_STATE code, and nothing else', () => {
    expect(goal('DiplomacyState', '2', '0', 'ENEMY')).toMatchObject({ state: 'enemy' });
    expect(goal('DiplomacyState', '2', '0', '2')).toMatchObject({ state: 'neutral' });
    expect(goal('DiplomacyState', '2', '0', 'allied')).toMatchObject({ state: undefined });
  });

  it('matches an opcode name case-insensitively and trimmed', () => {
    expect(goal('timegone', '5')).toEqual({ opcode: 'TimeGone', seconds: 5 });
    expect(result('sethumanx', '0', 'viking', 'carrier', '1', '2', '0', '0', '4')).toMatchObject({
      opcode: 'SetHumanX',
      amount: 4,
    });
    expect(goal('FindPosByHumans\r', '100', '23', '455', '10')).toMatchObject({
      opcode: 'FindPosByHumans',
      range: 10,
    });
  });

  it('resolves an unknown opcode to the approximated index-zero fallback', () => {
    expect(goal('NumberOfHumansNearPos', '100', '65', '45', '3', '1')).toEqual({ opcode: 'True' });
    expect(result('SetLandspace', '10', '20', 'stone', '0', '0')).toEqual({ opcode: 'None' });
    // Only the name is reported: the fallback declares no parameters, so the line's own tokens are
    // not counted against it.
    expect(
      warningsOf((warn) => decodeMissionResult({ key: 'result', values: ['Disable All', '0', '1'] }, warn)),
    ).toEqual([{ reason: 'unknownOpcode', opcode: 'Disable All' }]);
  });

  it('reads a missing token as zero and drops a surplus one, warning about both', () => {
    expect(result('AddGoodsToMapArea', 'wood', '20', '30', '40', '5', '1')).toEqual({
      opcode: 'AddGoodsToMapArea',
      good: { ref: 'name', name: 'wood' },
      amount: 20,
      point: { hx: 30, hy: 40 },
      range: 5,
      flag: true,
      player: 0,
    });
    expect(
      warningsOf((warn) =>
        decodeMissionResult({ key: 'result', values: ['ActivateMission', '3', '1'] }, warn),
      ),
    ).toEqual([{ reason: 'surplusTokens', opcode: 'ActivateMission', expected: 1, got: 2 }]);
    expect(
      warningsOf((warn) => decodeMissionResult({ key: 'result', values: ['PlaySound', '63'] }, warn)),
    ).toEqual([{ reason: 'missingTokens', opcode: 'PlaySound', expected: 3, got: 1 }]);
  });
});
