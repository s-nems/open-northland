import { describe, expect, it } from 'vitest';
import { BRIEFING_HISTORY_LIMIT, deliverMissionBriefing, FOG_MODE } from '../../src/components/index.js';
import { playerCommand } from '../../src/index.js';
import { type MissionDefinition, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import {
  loadPassAfter,
  missionSim,
  PASS_TICKS,
  POINT,
  roundTrip,
  scriptedSim,
  spawn,
  stamped,
} from './support.js';

const OWNER = 0;
const HUMAN = 7;
const PAGE = 500;
const STRING = 21;
/** The tick the fixture's spawns land and the fog mode takes effect; the script is enabled after it. */
const FOG_SETTLED = 1;

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
  it('keeps the replayable page and the delivered history across save and load', () => {
    const sim = missionSim([]);
    deliverMissionBriefing(sim.world, PAGE, true);
    const saved = roundTrip(sim);
    expect(saved.missionBriefingPage()).toBe(PAGE);
    expect(saved.missionBriefingHistory()).toEqual([PAGE]);
    deliverMissionBriefing(saved.world, PAGE + 1, false);
    const again = roundTrip(saved);
    expect(again.missionBriefingPage()).toBe(PAGE);
    expect(again.missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
  });

  it('retains a bounded distinct history without changing first-delivery order', () => {
    const sim = missionSim([]);
    for (let page = 0; page <= BRIEFING_HISTORY_LIMIT; page++) deliverMissionBriefing(sim.world, page, false);
    deliverMissionBriefing(sim.world, BRIEFING_HISTORY_LIMIT, false);
    expect(sim.missionBriefingHistory()).toEqual(
      Array.from({ length: BRIEFING_HISTORY_LIMIT }, (_, i) => i + 1),
    );
    expect(roundTrip(sim).missionBriefingHistory()).toEqual(sim.missionBriefingHistory());
  });

  it('opens a contact briefing after exploration and exposes the next objective across restore', () => {
    const rival = 1;
    const destination = { hx: 44, hy: POINT.hy };
    const sim = scriptedSim([
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
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: OWNER, to: rival, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: rival, to: OWNER, state: 'friend' });
    spawn(sim, { player: OWNER, missionId: HUMAN });
    spawn(sim, { player: rival, at: destination });
    loadPassAfter(sim, FOG_SETTLED);
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
    sim.run(PASS_TICKS);
    expect(sim.missionStatus()[1]?.done).toBe(true);
  });
});
