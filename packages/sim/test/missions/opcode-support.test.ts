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
};

const RESULT_SAMPLES: { [K in SupportedResult]: Extract<MissionResultOp, { opcode: K }> } = {
  None: { opcode: 'None' },
  ActivateMission: { opcode: 'ActivateMission', missionIndex: 0 },
  DeactivateMission: { opcode: 'DeactivateMission', missionIndex: 0 },
  DisableAll: { opcode: 'DisableAll' },
  SetVisible: { opcode: 'SetVisible', missionIndex: 0, flag: true },
  Exit: { opcode: 'Exit' },
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
    expect(reportedOpcodes([], [{ opcode: 'RemoveHumans', humanId: 1 }])).toEqual(['RemoveHumans']);
  });
});
