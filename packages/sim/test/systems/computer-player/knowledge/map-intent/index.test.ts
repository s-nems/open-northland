import { describe, expect, it } from 'vitest';
import { scenario } from '../../../../../src/index.js';
import { seatMapIntentSummaryOf } from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import { type MissionScript, SUCCESSFUL_IF } from '../../../../../src/systems/missions/index.js';
import { testContent } from '../../../../fixtures/content.js';

const SEAT = 0;
const RIVAL = 3;

/** Mission 0 fires at once; mission 1 names the seat won once the rival dies, which it does not. */
const SCRIPT: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [],
      results: [{ opcode: 'ActivateMission', missionIndex: 1 }],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: false,
      visible: false,
      goals: [{ opcode: 'PlayerDied', player: RIVAL }],
      results: [{ opcode: 'MissionWon', player: SEAT }],
    },
  ],
};

describe('a seat`s map intent summary', () => {
  it('overlays the live mission state and falls back to the skirmish rule', () => {
    const content = testContent();
    const { sim } = scenario(content, { seed: 1, missions: SCRIPT })
      .command({ kind: 'setMissionsEnabled', enabled: true })
      .run(1);
    const summary = seatMapIntentSummaryOf(sim.world, { content, missions: SCRIPT }, SEAT);
    expect(summary.victory).toBe('elimination');
    expect(summary.territoryKnown).toBe(false);
    expect(summary.objectives).toEqual([
      expect.objectContaining({
        source: 'script',
        mission: 1,
        status: 'active',
        objective: { kind: 'defeatPlayers', players: [RIVAL] },
      }),
      expect.objectContaining({ source: 'skirmish', status: null, objective: { kind: 'eliminateRivals' } }),
    ]);
  });
});
