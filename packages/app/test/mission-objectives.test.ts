import {
  exportSaveGame,
  type MissionDefinition,
  type MissionScript,
  restoreSimulation,
  Simulation,
  SUCCESSFUL_IF,
  systems,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  briefingMatchObjectives,
  type MissionBriefSource,
  missionGoalList,
  missionReader,
} from '../src/game/mission-brief.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

const opening: MissionDefinition = {
  active: true,
  visible: true,
  description: 10,
  successfullIf: SUCCESSFUL_IF.all,
  goals: [{ opcode: 'True' }],
  results: [{ opcode: 'PlayCutscene', cutscene: 100, replay: true }],
};

function source(script: MissionScript): MissionBriefSource {
  return {
    page: () => null,
    fallback: { title: 'Test mission' },
    skirmishGoal: 'Win the match',
    matchObjectives: briefingMatchObjectives(script),
  };
}

describe('opening briefing objectives', () => {
  it('recognises only initially visible, unconditional briefing instructions', () => {
    const variants: MissionDefinition[] = [
      opening,
      { ...opening, active: false },
      { ...opening, visible: false },
      { ...opening, goals: [{ opcode: 'TimeGone', seconds: 3 }] },
      { ...opening, goals: [] },
      { ...opening, successfullIf: SUCCESSFUL_IF.none },
      { ...opening, results: [] },
      { ...opening, successfullIf: SUCCESSFUL_IF.any },
      { ...opening, successfullIf: SUCCESSFUL_IF.half },
      { ...opening, successfullIf: 99 },
    ];
    expect([...briefingMatchObjectives({ missions: variants })]).toEqual(['0', '7', '8']);
    expect(briefingMatchObjectives(undefined).size).toBe(0);
  });

  it('keeps the overall goal open across the briefing and restore, then completes it on victory', () => {
    const script: MissionScript = {
      missions: [
        opening,
        {
          ...opening,
          description: 11,
          goals: [{ opcode: 'TimeGone', seconds: 3 }],
          results: [
            { opcode: 'SetVisible', missionIndex: 2, flag: true },
            { opcode: 'ActivateMission', missionIndex: 2 },
          ],
        },
        { ...opening, active: false, visible: false, description: 12 },
        {
          ...opening,
          visible: false,
          goals: [{ opcode: 'TimeGone', seconds: 12 }],
          results: [{ opcode: 'MissionWon', player: 0 }],
        },
        { ...opening, active: false, description: 14, results: [] },
      ],
    };
    const content = sandboxContent();
    const original = new Simulation({ seed: 1, content, missions: script });
    original.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    original.step();
    expect(original.missionStatus()[0]).toMatchObject({ done: true, fireCount: 1 });
    const restored = restoreSimulation(exportSaveGame(original), { content, missions: script });
    for (const sim of [original, restored]) {
      const reader = missionReader(
        source(script),
        { tick: () => sim.tick, status: () => sim.missionStatus(), outcome: () => sim.matchOutcome(0) },
        (id) => `Objective ${id}`,
      );
      const states = () => reader.goals().map(({ key, state }) => [key, state]);
      expect(states()).toEqual([
        ['0', 'open'],
        ['1', 'open'],
        ['4', 'idle'],
      ]);
      sim.run(TICKS_PER_SECOND * 6);
      expect(states()).toEqual([
        ['0', 'open'],
        ['1', 'done'],
        ['2', 'done'],
        ['4', 'idle'],
      ]);
      sim.run(TICKS_PER_SECOND * 12 + systems.MISSION_EVALUATION_TICKS);
      expect(sim.matchOutcome(0)).toBe('victory');
      expect(states()).toEqual([
        ['0', 'done'],
        ['1', 'done'],
        ['2', 'done'],
        ['4', 'idle'],
      ]);
      const defeated = missionGoalList(source(script), sim.missionStatus(), (id) => String(id), 'defeat');
      expect(defeated.find((goal) => goal.key === '0')?.state).toBe('open');
    }
  });
});
