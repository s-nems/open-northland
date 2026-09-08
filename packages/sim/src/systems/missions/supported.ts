import type { MissionGoalOp, MissionResultOp } from './script.js';

/**
 * The goal opcodes this build evaluates. The switch in `check.ts` is the implementation; this list is
 * what the coverage report and the opcode-support test read, and the test holds the two together.
 */
export const SUPPORTED_GOALS = [
  'True',
  'TimeGone',
  'RandomTimeGone',
  'IfMissionIsActive',
  'CheckMission',
  'IsMissionDone',
  'BuildHumans',
  'BuildHouses',
  'HumansDied',
  'HousesDied',
  'AnimalsDied',
  'NumberOfHumansDied',
  'SoldiersDied',
  'NumberOfHumansKilled',
  'Population',
  'NumberOfSoldiers',
  'HumansWithHome',
  'CheckHumanJob',
  'HumanAttachedToWorkHouse',
] as const satisfies readonly MissionGoalOp['opcode'][];

/** The result opcodes this build executes; see {@link SUPPORTED_GOALS}. */
export const SUPPORTED_RESULTS = [
  'None',
  'ActivateMission',
  'DeactivateMission',
  'DisableAll',
  'SetVisible',
  'Exit',
  'SetHuman',
  'SetHumanX',
  'SetAnimal',
  'SetHouse',
  'SetHouseExtensionLevel',
  'RemoveHumans',
  'RemoveAnimals',
  'RemoveHouses',
  'ChangeHumanPlayerId',
  'ChangeHousesPlayerId',
  'ChangePlayerPlayerId',
  'ChangePlayerIdInArea',
  'ChangeAnimalPlayerIdInArea',
  'ChangeMissionIdOfPlayer',
  'ChangeMissionIdOfHumanInRange',
  'ChangeHumanObjectIdInArea',
] as const satisfies readonly MissionResultOp['opcode'][];
