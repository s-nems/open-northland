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
] as const satisfies readonly MissionGoalOp['opcode'][];

/** The result opcodes this build executes; see {@link SUPPORTED_GOALS}. */
export const SUPPORTED_RESULTS = [
  'None',
  'ActivateMission',
  'DeactivateMission',
  'DisableAll',
  'SetVisible',
  'Exit',
] as const satisfies readonly MissionResultOp['opcode'][];
