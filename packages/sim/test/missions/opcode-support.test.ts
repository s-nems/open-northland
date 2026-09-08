import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import type { MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import {
  MISSION_EVALUATION_TICKS,
  SUPPORTED_GOALS,
  SUPPORTED_RESULTS,
} from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The published support lists against the evaluators themselves: the coverage report reads the lists,
 * so a name that drifts out of the switch would report coverage the sim does not have.
 */

type SupportedGoal = (typeof SUPPORTED_GOALS)[number];
type SupportedResult = (typeof SUPPORTED_RESULTS)[number];

/** One well-formed line per listed opcode; the mapped type is what forces an entry for each. */
const GOAL_SAMPLES: { [K in SupportedGoal]: Extract<MissionGoalOp, { opcode: K }> } = {
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
};

const POINT = { hx: 4, hy: 4 };

const RESULT_SAMPLES: { [K in SupportedResult]: Extract<MissionResultOp, { opcode: K }> } = {
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
  SetHouse: {
    opcode: 'SetHouse',
    player: 0,
    houseName: { typeId: 1, tribe: 1 },
    level: 0,
    asSite: false,
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
  ChangeHumanObjectIdInArea: {
    opcode: 'ChangeHumanObjectIdInArea',
    player: 0,
    point: POINT,
    range: 4,
    humanId: 7,
  },
};

function reportedOpcodes(goals: MissionGoalOp[], results: MissionResultOp[]): string[] {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    missions: { missions: [{ successfullIf: 0, active: true, visible: false, goals, results }] },
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
    expect(reportedOpcodes([{ opcode: 'PlayerDied', player: 0 }], [])).toEqual(['PlayerDied']);
    expect(reportedOpcodes([], [{ opcode: 'MissionFailed', player: 0 }])).toEqual(['MissionFailed']);
  });
});
