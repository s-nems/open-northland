import { describe, expect, it } from 'vitest';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { FIRST_PASS, missionSim, roundTrip } from './support.js';

describe('saved mission execution history', () => {
  it('counts repeated executions and continues the same history after restore', () => {
    const sim = missionSim([
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'ActivateMission', missionIndex: 0 }],
      },
    ]);
    expect(sim.missionStatus()[0]?.fireCount).toBe(0);
    sim.run(FIRST_PASS * 2);
    expect(sim.missionStatus()[0]).toMatchObject({
      firstFiredTick: FIRST_PASS,
      lastFiredTick: FIRST_PASS * 2,
      fireCount: 2,
    });
    const restored = roundTrip(sim);
    sim.run(FIRST_PASS);
    restored.run(FIRST_PASS);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.missionStatus()[0]).toMatchObject({
      firstFiredTick: FIRST_PASS,
      lastFiredTick: FIRST_PASS * 3,
      fireCount: 3,
    });
  });

  it('does not report a successful CheckMission probe as a result execution', () => {
    const sim = missionSim([
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'CheckMission', missionIndex: 1 }],
        results: [],
      },
      { active: false, visible: false, successfullIf: SUCCESSFUL_IF.all, goals: [], results: [] },
    ]);
    sim.run(FIRST_PASS);
    expect(sim.missionStatus()[0]?.fireCount).toBe(1);
    expect(sim.missionStatus()[1]).toMatchObject({ done: true, fireCount: 0 });
    expect(sim.missionStatus()[1]?.lastFiredTick).toBeUndefined();
  });
});
