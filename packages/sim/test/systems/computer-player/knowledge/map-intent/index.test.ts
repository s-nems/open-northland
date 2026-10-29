import { describe, expect, it } from 'vitest';
import { seatMapIntentOf } from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import { type MissionScript, SUCCESSFUL_IF } from '../../../../../src/systems/missions/index.js';
import { testContent } from '../../../../fixtures/content.js';

const SEAT = 0;
const RIVAL = 3;

/** Mission 0 activates mission 1, which names the seat won once the rival dies. */
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

describe('a seat`s map intent', () => {
  it('lists the script objectives that name the seat, and no threat without a territory', () => {
    const intent = seatMapIntentOf({ content: testContent(), missions: SCRIPT }, SEAT, null);
    expect(intent.objectives).toEqual([
      expect.objectContaining({ mission: 1, objective: { kind: 'defeatPlayers', players: [RIVAL] } }),
    ]);
    expect(intent.threats).toEqual([]);
  });
});
