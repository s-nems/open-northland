import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import type { MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import {
  MISSION_EVALUATION_TICKS,
  SUCCESSFUL_IF,
  SUPPORTED_GOALS,
  SUPPORTED_RESULTS,
} from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The published support lists against the evaluators themselves: the coverage report reads the lists,
 * so a name that drifts out of the switch would report coverage the sim does not have.
 */

type SupportedGoal = (typeof SUPPORTED_GOALS)[number];
type SupportedResult = (typeof SUPPORTED_RESULTS)[number];

const POINT = { hx: 4, hy: 4 };

/** One well-formed line per listed opcode; the mapped type is what forces an entry for each. */
const GOAL_SAMPLES: { [K in SupportedGoal]: Extract<MissionGoalOp, { opcode: K }> } = {
  DetectGuide: { opcode: 'DetectGuide', player: 0, point: POINT, range: 1 },
  IsAnyLandscapeOnPoint: { opcode: 'IsAnyLandscapeOnPoint', point: POINT },
  NumberOfAnimals: { opcode: 'NumberOfAnimals', player: 0, tribe: 9, amount: 1 },
  True: { opcode: 'True' },
  TimeGone: { opcode: 'TimeGone', seconds: 1 },
  RandomTimeGone: { opcode: 'RandomTimeGone', seconds: 4 },
  IfMissionIsActive: { opcode: 'IfMissionIsActive', missionIndex: 0 },
  CheckMission: { opcode: 'CheckMission', missionIndex: 0 },
  IsMissionDone: { opcode: 'IsMissionDone', missionIndex: 0 },
  BuildHumans: { opcode: 'BuildHumans', player: 0, job: 1, amount: 1, humanId: 7 },
  BuildHouses: { opcode: 'BuildHouses', player: 0, houseType: 1, amount: 1, objectId: 7 },
  HumansDied: { opcode: 'HumansDied', humanId: 7 },
  HousesDied: { opcode: 'HousesDied', objectId: 7 },
  AnimalsDied: { opcode: 'AnimalsDied', objectId: 7 },
  NumberOfHumansDied: { opcode: 'NumberOfHumansDied', player: 0, amount: 1 },
  SoldiersDied: { opcode: 'SoldiersDied', player: 0, amount: 1 },
  NumberOfHumansKilled: { opcode: 'NumberOfHumansKilled', player: 0, amount: 1 },
  Population: { opcode: 'Population', player: 0, amount: 1 },
  NumberOfSoldiers: { opcode: 'NumberOfSoldiers', player: 0, amount: 1 },
  HumansWithHome: { opcode: 'HumansWithHome', player: 0, amount: 1 },
  CheckHumanJob: { opcode: 'CheckHumanJob', humanId: 7, job: 1 },
  HumanAttachedToWorkHouse: { opcode: 'HumanAttachedToWorkHouse', player: 0, job: 1, amount: 1 },
  FindPosByHumans: { opcode: 'FindPosByHumans', humanId: 7, point: POINT, range: 3 },
  FindPosByPlayersMapMoveable: {
    opcode: 'FindPosByPlayersMapMoveable',
    player: 0,
    point: POINT,
    range: 3,
  },
  FindHumansByHumans: { opcode: 'FindHumansByHumans', humanId: 7, otherHumanId: 8, range: 3 },
  FindHumansByPlayersMM: { opcode: 'FindHumansByPlayersMM', humanId: 7, player: 0, range: 3 },
  FindHousesByHumans: { opcode: 'FindHousesByHumans', humanId: 7, objectId: 8, range: 3 },
  NumberOfSoldiersNearPos: {
    opcode: 'NumberOfSoldiersNearPos',
    player: 0,
    point: POINT,
    range: 3,
    amount: 1,
  },
  NumberOfCivilainsNearPos: {
    opcode: 'NumberOfCivilainsNearPos',
    player: 0,
    point: POINT,
    range: 3,
    amount: 1,
  },
  ChestNearPos: { opcode: 'ChestNearPos', point: POINT, range: 3 },
  NumberOfHousesInArea: {
    opcode: 'NumberOfHousesInArea',
    player: 0,
    houseType: 1,
    amount: 1,
    point: POINT,
    range: 3,
  },
  NumberOfAnimalsInArea: {
    opcode: 'NumberOfAnimalsInArea',
    player: 0,
    tribe: 1,
    amount: 1,
    point: POINT,
    range: 3,
  },
  GoodsInHouses: { opcode: 'GoodsInHouses', objectId: 7, good: 1, amount: 1 },
  GoodsGlobal: { opcode: 'GoodsGlobal', player: 0, good: 1, amount: 1 },
  NumberOfGoodsInArea: {
    opcode: 'NumberOfGoodsInArea',
    player: 0,
    good: 1,
    amount: 1,
    point: POINT,
    range: 3,
  },
  NumberOfGoodsInHousesInArea: {
    opcode: 'NumberOfGoodsInHousesInArea',
    player: 0,
    good: 1,
    amount: 1,
    point: POINT,
    range: 3,
  },
  JobEnabled: { opcode: 'JobEnabled', player: 0, tribe: 1, job: 1 },
  GoodProduceable: { opcode: 'GoodProduceable', player: 0, tribe: 1, good: 1 },
  FindPos: { opcode: 'FindPos', player: 0, point: POINT },
  FindHumans: { opcode: 'FindHumans', player: 0, humanId: 7 },
  FindHouses: { opcode: 'FindHouses', player: 0, objectId: 7 },
  FindAnimals: { opcode: 'FindAnimals', player: 0, objectId: 7 },
  PlayerDied: { opcode: 'PlayerDied', player: 0 },
  DiplomacyState: { opcode: 'DiplomacyState', player: 0, otherPlayer: 1, state: 'friend' },
  PlayerSeen: { opcode: 'PlayerSeen', player: 0, otherPlayer: 1 },
  PlayerAttackedByPlayer: { opcode: 'PlayerAttackedByPlayer', otherPlayer: 1, player: 0 },
  NumberOfGoodsTraded: { opcode: 'NumberOfGoodsTraded', player: 0, otherPlayer: 1, amount: 1 },
  PayTribute: { opcode: 'PayTribute', slot: 0 },
};

const RESULT_SAMPLES: { [K in SupportedResult]: Extract<MissionResultOp, { opcode: K }> } = {
  StartSubMission: { opcode: 'StartSubMission', campaignId: 0, mapId: 1 },
  EndSubMission: { opcode: 'EndSubMission' },
  SetLandscape: { opcode: 'SetLandscape', point: POINT, landscape: 1, level: 0, flag: false },
  RemoveLandscape: { opcode: 'RemoveLandscape', point: POINT },
  RemoveLandscapesInArea: { opcode: 'RemoveLandscapesInArea', point: POINT, range: 1 },
  RemoveFXWaveLandscapeInArea: { opcode: 'RemoveFXWaveLandscapeInArea', point: POINT, range: 1 },
  RemoveFXSmokeLandscapeInArea: { opcode: 'RemoveFXSmokeLandscapeInArea', point: POINT, range: 1 },
  RemoveBlockerLandscapeInArea: { opcode: 'RemoveBlockerLandscapeInArea', point: POINT, range: 1 },
  RemoveFX1LandscapeInArea: { opcode: 'RemoveFX1LandscapeInArea', point: POINT, range: 1 },
  RemoveFX2LandscapeInArea: { opcode: 'RemoveFX2LandscapeInArea', point: POINT, range: 1 },
  SetHouseBuildForbiddenArea: { opcode: 'SetHouseBuildForbiddenArea', point: POINT, range: 1, flag: true },
  SetVertexColor: { opcode: 'SetVertexColor', point: POINT, range: 1, amount: 127 },
  SetVertexColorOnLand: { opcode: 'SetVertexColorOnLand', point: POINT, range: 1, amount: 127 },
  None: { opcode: 'None' },
  ActivateMission: { opcode: 'ActivateMission', missionIndex: 0 },
  DeactivateMission: { opcode: 'DeactivateMission', missionIndex: 0 },
  DisableAll: { opcode: 'DisableAll' },
  SetVisible: { opcode: 'SetVisible', missionIndex: 0, flag: true },
  Exit: { opcode: 'Exit' },
  SetHuman: { opcode: 'SetHuman', player: 0, tribe: 1, job: 1, point: POINT, humanId: 7, behaviour: 0 },
  SetHumanX: {
    opcode: 'SetHumanX',
    player: 0,
    tribe: 1,
    job: 1,
    point: POINT,
    humanId: 7,
    behaviour: 0,
    amount: 1,
  },
  SetAnimal: { opcode: 'SetAnimal', player: 20, tribe: 1, job: 0, point: POINT, objectId: 7, behaviour: 0 },
  SetRandomChestOnPosition: { opcode: 'SetRandomChestOnPosition', amount: 2, point: POINT },
  SetRandomChestOnRandomPos: { opcode: 'SetRandomChestOnRandomPos', amount: 2 },
  SetHouse: {
    opcode: 'SetHouse',
    player: 0,
    houseName: { typeId: 1, tribe: 1 },
    level: 0,
    built: true,
    point: POINT,
    objectId: 7,
  },
  SetHouseExtensionLevel: { opcode: 'SetHouseExtensionLevel', objectId: 7, amount: 1 },
  RemoveHumans: { opcode: 'RemoveHumans', humanId: 7 },
  RemoveAnimals: { opcode: 'RemoveAnimals', objectId: 7 },
  RemoveHouses: { opcode: 'RemoveHouses', objectId: 7 },
  ChangeHumanPlayerId: { opcode: 'ChangeHumanPlayerId', humanId: 7, player: 1 },
  ChangeHousesPlayerId: { opcode: 'ChangeHousesPlayerId', objectId: 7, player: 1 },
  ChangePlayerPlayerId: { opcode: 'ChangePlayerPlayerId', player: 0, otherPlayer: 1 },
  ChangePlayerIdInArea: {
    opcode: 'ChangePlayerIdInArea',
    player: 0,
    otherPlayer: 1,
    point: POINT,
    range: 4,
  },
  ChangeAnimalPlayerIdInArea: {
    opcode: 'ChangeAnimalPlayerIdInArea',
    player: 20,
    tribe: 1,
    point: POINT,
    range: 4,
    amount: 1,
    otherPlayer: 1,
  },
  ChangeMissionIdOfPlayer: { opcode: 'ChangeMissionIdOfPlayer', player: 0, humanId: 7 },
  ChangeMissionIdOfHumanInRange: {
    opcode: 'ChangeMissionIdOfHumanInRange',
    player: 0,
    humanId: 7,
    point: POINT,
    range: 4,
  },
  SendHuman: { opcode: 'SendHuman', humanId: 7, point: POINT },
  MoveHuman: { opcode: 'MoveHuman', humanId: 7, point: POINT },
  MoveUnitsInArea: {
    opcode: 'MoveUnitsInArea',
    player: 0,
    point: POINT,
    range: 2,
    index: 20,
    extra: 20,
  },
  StopHumanByPlayerId: { opcode: 'StopHumanByPlayerId', player: 0 },
  RemoveHumansNearPos: { opcode: 'RemoveHumansNearPos', point: POINT, range: 2 },
  HealHumansInArea: { opcode: 'HealHumansInArea', point: POINT, range: 2 },
  RemoveHPsOfHousesInArea: {
    opcode: 'RemoveHPsOfHousesInArea',
    player: 0,
    point: POINT,
    range: 2,
    amount: 1,
  },
  RemoveHPsOfHousesInAreaX: {
    opcode: 'RemoveHPsOfHousesInAreaX',
    player: 0,
    point: POINT,
    range: 2,
    amount: 1,
    objectId: 7,
  },
  SetHumanBehaviourFlag: { opcode: 'SetHumanBehaviourFlag', humanId: 7, amount: 1, flag: true },
  SetPlayerBehaviourFlag: { opcode: 'SetPlayerBehaviourFlag', player: 0, amount: 1, flag: true },
  SetImportHumanFlag: { opcode: 'SetImportHumanFlag', humanId: 7, flag: true },
  SetHouseBehaviourFlag: { opcode: 'SetHouseBehaviourFlag', objectId: 7, index: 0, flag: true },
  ChangeHumanObjectIdInArea: {
    opcode: 'ChangeHumanObjectIdInArea',
    player: 0,
    point: POINT,
    range: 4,
    humanId: 7,
  },
  AddGoodsToHouses: { opcode: 'AddGoodsToHouses', objectId: 7, good: 1, amount: 1 },
  AddGoodsToAnyStock: { opcode: 'AddGoodsToAnyStock', player: 0, good: 1, amount: 1 },
  AddGoodsToMapArea: {
    opcode: 'AddGoodsToMapArea',
    good: 1,
    amount: 1,
    point: POINT,
    range: 2,
    flag: false,
    player: 0,
  },
  RemoveGoodsFromMapArea: {
    opcode: 'RemoveGoodsFromMapArea',
    good: 1,
    amount: 1,
    point: POINT,
    range: 2,
    flag: false,
    player: 0,
  },
  AllowJob: { opcode: 'AllowJob', player: 0, tribe: 1, job: 1 },
  EnableJob: { opcode: 'EnableJob', player: 0, tribe: 1, job: 1 },
  AllowHouse: { opcode: 'AllowHouse', player: 0, tribe: 1, houseType: 1 },
  EnableHouse: { opcode: 'EnableHouse', player: 0, tribe: 1, houseType: 1 },
  AllowGood: { opcode: 'AllowGood', player: 0, tribe: 1, good: 1 },
  EnableGood: { opcode: 'EnableGood', player: 0, tribe: 1, good: 1 },
  SetDiplomacy: { opcode: 'SetDiplomacy', player: 0, otherPlayer: 1, state: 'friend' },
  SetDiplomacyNotChangeableFlag: {
    opcode: 'SetDiplomacyNotChangeableFlag',
    player: 0,
    otherPlayer: 1,
    flag: true,
  },
  MissionWon: { opcode: 'MissionWon', player: 0 },
  MissionFailed: { opcode: 'MissionFailed', player: 0 },
  ExploreArea: { opcode: 'ExploreArea', player: 0, point: POINT, range: 2 },
  SetExternalFlag: { opcode: 'SetExternalFlag', player: 0, flagId: 1, flag: true },
  CreateTribute: { opcode: 'CreateTribute', slot: 0, player: 0, otherPlayer: 1, stringId: 1 },
  AddTributeGoods: { opcode: 'AddTributeGoods', slot: 0, good: 1, amount: 1 },
  ClearTribute: { opcode: 'ClearTribute', slot: 0 },
  PlayCutscene: { opcode: 'PlayCutscene', cutscene: 500, replay: true },
  PlaySound: { opcode: 'PlaySound', sound: 1, point: POINT },
  SetCameraPosition: { opcode: 'SetCameraPosition', point: POINT },
  SelectHuman: { opcode: 'SelectHuman', humanId: 7, flag: false },
  SetHumanName: { opcode: 'SetHumanName', humanId: 7, stringId: 100 },
  SetGuiMarker: { opcode: 'SetGuiMarker', objectId: 1, point: POINT },
  SetImportLandscapeMarker: { opcode: 'SetImportLandscapeMarker', point: POINT, flag: true },
  SetMapAreaMarker: { opcode: 'SetMapAreaMarker', point: POINT, range: 3, flag: true, index: 1 },
  SetMapAreaMarkerMagic: { opcode: 'SetMapAreaMarkerMagic', point: POINT, range: 3, flag: true, index: 1 },
  SetWeather: { opcode: 'SetWeather', point: POINT, range: 3, flag: false, amount: 5 },
  StartEarthQuake: { opcode: 'StartEarthQuake', seconds: 2 },
  InfoClear: { opcode: 'InfoClear', player: 0, index: 0 },
  InfoShowString: { opcode: 'InfoShowString', player: 0, index: 0, stringId: 1 },
  InfoCountGoodsInArea: {
    opcode: 'InfoCountGoodsInArea',
    player: 0,
    index: 0,
    stringId: 1,
    good: 1,
    point: POINT,
    range: 3,
    extra: 0,
  },
  InfoCountHousesInArea: {
    opcode: 'InfoCountHousesInArea',
    player: 0,
    index: 0,
    stringId: 1,
    houseType: 1,
    point: POINT,
    range: 3,
    extra: 0,
  },
  InfoCountHumenInArea: {
    opcode: 'InfoCountHumenInArea',
    player: 0,
    index: 0,
    stringId: 1,
    point: POINT,
    range: 3,
    extra: 0,
  },
  InfoCountSoldiersInArea: {
    opcode: 'InfoCountSoldiersInArea',
    player: 0,
    index: 0,
    stringId: 1,
    point: POINT,
    range: 3,
    extra: 0,
  },
  InfoCountAnimalsInArea: {
    opcode: 'InfoCountAnimalsInArea',
    player: 0,
    index: 0,
    stringId: 1,
    tribe: 1,
    point: POINT,
    range: 3,
    extra: 0,
  },
};

function reportedOpcodes(goals: MissionGoalOp[], results: MissionResultOp[]): string[] {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: { ...grassNodeMap(10, 10), landscapes: { types: [], placements: [] } },
    missions: {
      missions: [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals, results }],
    },
  });
  sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
  sim.run(MISSION_EVALUATION_TICKS);
  return sim.events.current().flatMap((e) => (e.kind === 'missionUnsupported' ? [e.opcode] : []));
}

describe('the published opcode support lists', () => {
  it('names every opcode the evaluators actually run', () => {
    for (const opcode of SUPPORTED_GOALS) {
      expect(`${opcode}: ${reportedOpcodes([GOAL_SAMPLES[opcode]], []).join()}`).toBe(`${opcode}: `);
    }
    for (const opcode of SUPPORTED_RESULTS) {
      expect(`${opcode}: ${reportedOpcodes([], [RESULT_SAMPLES[opcode]]).join()}`).toBe(`${opcode}: `);
    }
  });

  it('reports an opcode outside the lists, so the lists are the whole of it', () => {
    expect(
      reportedOpcodes([{ opcode: 'BuildVehicles', player: 0, vehicleType: 1, amount: 1, vehicleId: 7 }], []),
    ).toEqual(['BuildVehicles']);
    expect(reportedOpcodes([], [{ opcode: 'RemoveVehicles', vehicleId: 1 }])).toEqual(['RemoveVehicles']);
  });
});
