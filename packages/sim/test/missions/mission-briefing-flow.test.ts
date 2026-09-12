import { describe, expect, it } from 'vitest';
import {
  BRIEFING_HISTORY_LIMIT,
  FOG_MODE,
  retainMissionBriefing,
  setMissionBriefingPage,
} from '../../src/components/index.js';
import { playerCommand } from '../../src/index.js';
import { type MissionDefinition, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { FIRST_PASS, missionSim, POINT, roundTrip, spawn, stamped } from './support.js';

const OWNER = 0;
const HUMAN = 7;
const PAGE = 500;
const STRING = 21;

function mission(definition: Partial<MissionDefinition>): MissionDefinition {
  return {
    successfullIf: SUCCESSFUL_IF.all,
    active: true,
    visible: false,
    goals: [],
    results: [],
    ...definition,
  };
}

describe('briefing delivery and persistence', () => {
  it('recovers the replayable page from saves without a delivered-page history', () => {
    const sim = missionSim([]);
    setMissionBriefingPage(sim.world, PAGE);
    const saved = roundTrip(sim);
    const hash = saved.hashState();
    expect(saved.missionBriefingHistory()).toEqual([PAGE]);
    expect(saved.hashState()).toBe(hash);
    retainMissionBriefing(saved.world, PAGE + 1);
    expect(roundTrip(saved).missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
  });

  it('retains a bounded distinct history without changing first-delivery order', () => {
    const sim = missionSim([]);
    for (let page = 0; page <= BRIEFING_HISTORY_LIMIT; page++) retainMissionBriefing(sim.world, page);
    retainMissionBriefing(sim.world, BRIEFING_HISTORY_LIMIT);
    expect(sim.missionBriefingHistory()).toEqual(
      Array.from({ length: BRIEFING_HISTORY_LIMIT }, (_, i) => i + 1),
    );
    expect(roundTrip(sim).missionBriefingHistory()).toEqual(sim.missionBriefingHistory());
  });

  it('opens a contact briefing after exploration and exposes the next objective across restore', () => {
    const rival = 1;
    const destination = { hx: 44, hy: POINT.hy };
    const sim = missionSim([
      mission({
        goals: [{ opcode: 'PlayerSeen', player: OWNER, otherPlayer: rival }],
        results: [
          { opcode: 'ActivateMission', missionIndex: 1 },
          { opcode: 'SetVisible', missionIndex: 1, flag: true },
          { opcode: 'PlayCutscene', cutscene: PAGE, replay: false },
        ],
      }),
      mission({ active: false, description: STRING, goals: [{ opcode: 'TimeGone', seconds: 3 }] }),
    ]);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: OWNER, to: rival, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: rival, to: OWNER, state: 'friend' });
    spawn(sim, { player: OWNER, missionId: HUMAN });
    spawn(sim, { player: rival, at: destination });
    sim.run(FIRST_PASS);
    expect(sim.missionBriefingHistory()).toEqual([]);
    expect(sim.missionStatus()[1]?.visible).toBe(false);
    const restored = roundTrip(sim);
    const order = playerCommand(OWNER, {
      kind: 'moveUnit',
      entity: stamped(sim, HUMAN),
      x: destination.hx,
      y: destination.hy,
    });
    sim.enqueue(order);
    restored.enqueue(order);
    const explorationBudget = 1200;
    for (let tick = 0; tick < explorationBudget && sim.missionBriefingHistory().length === 0; tick++) {
      sim.step();
      restored.step();
    }
    expect(sim.events.current()).toContainEqual({
      kind: 'missionCutscene',
      mission: 0,
      page: PAGE,
      replay: false,
    });
    expect(sim.missionStatus()[1]).toMatchObject({ visible: true, active: true, done: false });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(roundTrip(sim).missionBriefingHistory()).toEqual([PAGE]);
    sim.run(FIRST_PASS);
    expect(sim.missionStatus()[1]?.done).toBe(true);
  });
});
