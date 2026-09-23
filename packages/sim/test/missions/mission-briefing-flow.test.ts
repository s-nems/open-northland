import { describe, expect, it } from 'vitest';
import {
  BRIEFING_HISTORY_LIMIT,
  deliverMissionBriefing,
  FOG_MODE,
  Owner,
  Position,
  Signpost,
} from '../../src/components/index.js';
import { playerCommand, positionOfNode } from '../../src/index.js';
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
  it('ignores a revealed foreign signpost until an inhabitant is discovered, including shared vision', () => {
    const rival = 2;
    const sim = scriptedSim([
      mission({
        goals: [{ opcode: 'PlayerSeen', player: OWNER, otherPlayer: rival }],
        results: [{ opcode: 'PlayCutscene', cutscene: PAGE, replay: true }],
      }),
    ]);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    sim.enqueueSetup({ kind: 'setSharedVision', players: [OWNER, 1] });
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(POINT.hx, POINT.hy));
    sim.world.add(post, Owner, { player: rival });
    sim.world.add(post, Signpost, { links: [] });
    sim.step();
    sim.fog?.revealArea(1, POINT, 1);
    loadPassAfter(sim, PASS_TICKS);
    expect(sim.hasMetPlayer(OWNER, rival)).toBe(false);
    expect(sim.hasMetPlayer(1, rival)).toBe(false);
    expect(sim.missionBriefingHistory()).toEqual([]);
    const restored = roundTrip(sim);
    spawn(restored, { player: rival });
    restored.run(PASS_TICKS);
    expect(restored.hasMetPlayer(OWNER, rival)).toBe(true);
    expect(restored.hasMetPlayer(1, rival)).toBe(true);
    expect(restored.missionBriefingHistory()).toEqual([PAGE]);
  });

  it('delivers simultaneous settlement briefings in script order across save and restore', () => {
    const sim = scriptedSim([
      mission({ results: [{ opcode: 'ExploreArea', player: OWNER, point: POINT, range: 1000 }] }),
      ...[1, 2].map((rival) =>
        mission({
          goals: [{ opcode: 'PlayerSeen', player: OWNER, otherPlayer: rival }],
          results: [{ opcode: 'PlayCutscene', cutscene: PAGE + rival, replay: true }],
        }),
      ),
      mission({
        goals: [{ opcode: 'FindPosByHumans', humanId: HUMAN, point: { hx: 44, hy: 44 }, range: 1 }],
        results: [{ opcode: 'PlayCutscene', cutscene: PAGE + 3, replay: true }],
      }),
    ]);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    spawn(sim, { player: OWNER, missionId: HUMAN });
    spawn(sim, { player: 1, at: { hx: 42, hy: 4 } });
    spawn(sim, { player: 2, at: { hx: 4, hy: 42 } });
    loadPassAfter(sim, FOG_SETTLED);
    expect(sim.missionBriefingHistory()).toEqual([]);
    sim.run(PASS_TICKS);
    expect(sim.missionBriefingHistory()).toEqual([PAGE + 1]);
    expect(sim.missionStatus()[2]?.active).toBe(true);
    const restored = roundTrip(sim);
    restored.run(PASS_TICKS * 2);
    expect(restored.missionBriefingHistory()).toEqual([PAGE + 1, PAGE + 2]);
    expect(restored.missionStatus()[3]).toMatchObject({ active: true, done: false });
    expect(restored.missionBriefingPage()).toBe(PAGE + 2);
  });

  it('delivers a later objective briefing for a settlement met before activation', () => {
    const sim = scriptedSim([
      mission({
        goals: [{ opcode: 'TimeGone', seconds: 6 }],
        results: [
          { opcode: 'ActivateMission', missionIndex: 1 },
          { opcode: 'PlayCutscene', cutscene: PAGE, replay: true },
        ],
      }),
      mission({
        active: false,
        goals: [{ opcode: 'PlayerSeen', player: OWNER, otherPlayer: 1 }],
        results: [{ opcode: 'PlayCutscene', cutscene: PAGE + 1, replay: true }],
      }),
    ]);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    spawn(sim, { player: 1 });
    sim.fog?.revealArea(OWNER, POINT, 1);
    loadPassAfter(sim, FOG_SETTLED);
    expect(sim.hasMetPlayer(OWNER, 1)).toBe(true);
    expect(sim.missionStatus()[1]?.active).toBe(false);
    expect(sim.missionBriefingHistory()).toEqual([]);
    const restored = roundTrip(sim);
    restored.run(PASS_TICKS * 4);
    expect(restored.missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
    expect(restored.missionStatus()[1]?.done).toBe(true);
  });

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
