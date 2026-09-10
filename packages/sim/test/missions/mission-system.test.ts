import { describe, expect, it } from 'vitest';
import { missionRecords, missionStateExists } from '../../src/components/index.js';
import type { SimEvent } from '../../src/core/events.js';
import { Simulation, TICKS_PER_SECOND } from '../../src/index.js';
import type {
  MissionDefinition,
  MissionGoalOp,
  MissionResultOp,
  MissionScript,
} from '../../src/systems/missions/index.js';
import { MISSION_EVALUATION_TICKS, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The mission engine: its evaluation cadence, the `successfullif` verdicts, the deactivate-then-execute
 * order, and the control-flow opcodes. Every world here is mapless - the stage's opcodes read mission
 * records and the clock, never the map.
 */

/** The tick the first pass runs on: `setMissionsEnabled` applies on tick 1, so the records exist well
 *  before the first multiple of the cadence. */
const FIRST_PASS = MISSION_EVALUATION_TICKS;

function mission(definition: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    successfullIf: SUCCESSFUL_IF.all,
    active: true,
    visible: false,
    goals: [],
    results: [],
    ...definition,
  };
}

function missionSim(missions: readonly MissionDefinition[], seed = 1): Simulation {
  const script: MissionScript = { missions };
  const sim = new Simulation({ seed, content: testContent(), missions: script });
  sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
  return sim;
}

function records(sim: Simulation): ReturnType<typeof missionRecords> {
  return missionRecords(sim.world);
}

function eventsOfKind(sim: Simulation, kind: SimEvent['kind']): SimEvent[] {
  return sim.events.current().filter((e) => e.kind === kind);
}

/** Run until `predicate` holds at a tick boundary, or fail after `limit` ticks. */
function runUntil(sim: Simulation, limit: number, predicate: (sim: Simulation) => boolean): number {
  for (let tick = 0; tick < limit; tick++) {
    sim.step();
    if (predicate(sim)) return sim.tick;
  }
  throw new Error(`condition never held within ${limit} ticks`);
}

const TRUE_GOAL: MissionGoalOp = { opcode: 'True' };
const NO_RESULT: MissionResultOp = { opcode: 'None' };

describe('the mission system gate', () => {
  it('materializes no state and runs nothing while MissionRules is off', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), missions: { missions: [mission()] } });
    sim.run(FIRST_PASS + 1);
    expect(missionStateExists(sim.world)).toBe(false);
  });

  it('leaves a world built with no script untouched', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    sim.run(FIRST_PASS + 1);
    expect(missionStateExists(sim.world)).toBe(false);
  });

  it('takes the authored active and visible flags as the records it starts from', () => {
    const sim = missionSim([
      mission({ active: true, visible: true, goals: [TRUE_GOAL] }),
      mission({ active: false }),
    ]);
    sim.run(1);
    expect(records(sim).map((r) => [r.active, r.visible])).toEqual([
      [true, true],
      [false, false],
    ]);
    // An authored-active mission counts the tick its records appear as its activation.
    expect(records(sim)[0]?.activationTick).toBe(1);
  });
});

describe('the evaluation cadence', () => {
  it('fires nothing between two multiples of the cadence', () => {
    const sim = missionSim([mission({ goals: [TRUE_GOAL], results: [{ opcode: 'Exit' }] })]);
    sim.run(FIRST_PASS - 1);
    expect(records(sim)[0]?.active).toBe(true);
    sim.step();
    expect(sim.tick).toBe(FIRST_PASS);
    expect(records(sim)[0]?.active).toBe(false);
    expect(eventsOfKind(sim, 'missionExit')).toEqual([{ kind: 'missionExit', mission: 0 }]);
  });

  it('stops touching the world once no mission is active', () => {
    const sim = missionSim([mission({ goals: [TRUE_GOAL] })]);
    sim.run(FIRST_PASS);
    expect(records(sim)[0]?.active).toBe(false);
    const settled = sim.world.mutationVersion;
    sim.run(FIRST_PASS * 3);
    // A finished script must not re-dirty the world every three seconds: nothing derived from it
    // would ever stay cached.
    expect(sim.world.mutationVersion).toBe(settled);
  });

  it('counts a TimeGone from the activation tick, quantised to the cadence', () => {
    // 5 seconds is 60 ticks from the tick 1 activation, so the pass at 60 is one tick short.
    const sim = missionSim([mission({ goals: [{ opcode: 'TimeGone', seconds: 5 }] })]);
    const fired = runUntil(sim, 200, (s) => records(s)[0]?.active === false);
    expect(fired).toBe(72);
  });
});

describe('the successfullif rules', () => {
  const held: MissionGoalOp = { opcode: 'True' };
  const unheld: MissionGoalOp = { opcode: 'IfMissionIsActive', missionIndex: 99 };

  it.each([
    ['all, every goal held', SUCCESSFUL_IF.all, [held, held], true],
    ['all, one goal short', SUCCESSFUL_IF.all, [held, unheld], false],
    ['any, one goal held', SUCCESSFUL_IF.any, [unheld, held], true],
    ['any, none held', SUCCESSFUL_IF.any, [unheld, unheld], false],
    ['half of three, two held', SUCCESSFUL_IF.half, [held, held, unheld], true],
    ['half of three, one held', SUCCESSFUL_IF.half, [held, unheld, unheld], false],
    ['none, nothing held', SUCCESSFUL_IF.none, [unheld, unheld], true],
    ['none, one held', SUCCESSFUL_IF.none, [held, unheld], false],
    ['an unknown rule always holds', 7, [unheld, unheld], true],
  ])('judges %s', (_label, successfullIf, goals, fires) => {
    const sim = missionSim([mission({ successfullIf, goals })]);
    sim.run(FIRST_PASS);
    expect(records(sim)[0]?.evaluated).toBe(fires);
  });

  it.each([
    ['all', SUCCESSFUL_IF.all, true],
    ['any', SUCCESSFUL_IF.any, false],
    ['half', SUCCESSFUL_IF.half, true],
    ['none', SUCCESSFUL_IF.none, true],
  ])('holds a goalless mission under %s', (_label, successfullIf, fires) => {
    const sim = missionSim([mission({ successfullIf, goals: [] })]);
    sim.run(FIRST_PASS);
    expect(records(sim)[0]?.evaluated).toBe(fires);
  });
});

describe('activation', () => {
  it('records the tick only on the inactive-to-active transition', () => {
    // Mission 0 re-activates mission 1 on every pass; mission 1 waits out a long timer.
    const sim = missionSim([
      mission({ goals: [TRUE_GOAL], results: [{ opcode: 'ActivateMission', missionIndex: 1 }] }),
      mission({ active: false, goals: [{ opcode: 'TimeGone', seconds: 60 }] }),
    ]);
    sim.run(FIRST_PASS);
    const activated = records(sim)[1]?.activationTick;
    expect(activated).toBe(FIRST_PASS);
    sim.run(FIRST_PASS * 3);
    // Mission 0 keeps firing, but mission 1 was already active, so its clock never restarted.
    expect(records(sim)[1]?.activationTick).toBe(activated);
  });

  it('lets a mission re-activate itself to loop', () => {
    const sim = missionSim([
      mission({
        goals: [{ opcode: 'TimeGone', seconds: 1 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 0 }],
      }),
    ]);
    sim.run(FIRST_PASS);
    // Deactivate-then-execute: the mission's own result re-activated it, so it is active again and
    // its clock restarted on this pass.
    expect(records(sim)[0]?.active).toBe(true);
    expect(records(sim)[0]?.activationTick).toBe(FIRST_PASS);
  });

  it('clears every active flag on DisableAll', () => {
    const sim = missionSim([
      mission({ goals: [TRUE_GOAL], results: [{ opcode: 'DisableAll' }] }),
      mission({ active: true, goals: [{ opcode: 'TimeGone', seconds: 999 }] }),
      mission({ active: true, goals: [{ opcode: 'TimeGone', seconds: 999 }] }),
    ]);
    sim.run(FIRST_PASS);
    expect(records(sim).map((r) => r.active)).toEqual([false, false, false]);
  });

  it('shows and hides a mission through SetVisible', () => {
    const sim = missionSim([
      mission({ goals: [TRUE_GOAL], results: [{ opcode: 'SetVisible', missionIndex: 1, flag: true }] }),
      mission({ active: false, visible: false }),
    ]);
    sim.run(FIRST_PASS);
    expect(records(sim)[1]?.visible).toBe(true);
  });
});

describe('the mission-reading goals', () => {
  it('reads IsMissionDone off the stored flags, so it stays true after the mission fired', () => {
    const sim = missionSim([
      mission({ goals: [TRUE_GOAL], results: [NO_RESULT] }),
      mission({ goals: [{ opcode: 'IsMissionDone', missionIndex: 0 }] }),
    ]);
    sim.run(FIRST_PASS);
    // Mission 0 fired and deactivated on this pass; mission 1 read its flags in the same pass.
    expect(records(sim)[0]?.active).toBe(false);
    expect(records(sim)[1]?.evaluated).toBe(true);
  });

  it('answers IsMissionDone for a never-checked mission under the none rule', () => {
    const sim = missionSim([
      mission({ active: false, successfullIf: SUCCESSFUL_IF.none, goals: [TRUE_GOAL] }),
      mission({ goals: [{ opcode: 'IsMissionDone', missionIndex: 0 }] }),
    ]);
    sim.run(FIRST_PASS);
    // Mission 0 never ran, so its goal flag is still false and its "no goal holds" rule is met.
    expect(records(sim)[1]?.evaluated).toBe(true);
  });

  it('evaluates CheckMission without firing the checked mission', () => {
    const sim = missionSim([
      mission({ active: false, goals: [TRUE_GOAL], results: [{ opcode: 'Exit' }] }),
      mission({ goals: [{ opcode: 'CheckMission', missionIndex: 0 }] }),
    ]);
    sim.run(FIRST_PASS);
    expect(records(sim)[1]?.evaluated).toBe(true);
    // The probe stored mission 0's verdict but ran none of its results.
    expect(records(sim)[0]?.evaluated).toBe(true);
    expect(eventsOfKind(sim, 'missionExit')).toEqual([]);
  });

  it('stops a CheckMission cycle instead of recursing', () => {
    const sim = missionSim([
      mission({ goals: [{ opcode: 'CheckMission', missionIndex: 1 }] }),
      mission({ goals: [{ opcode: 'CheckMission', missionIndex: 0 }] }),
    ]);
    expect(() => sim.run(FIRST_PASS)).not.toThrow();
  });

  it('reads IfMissionIsActive off the live flag', () => {
    const sim = missionSim([
      mission({ active: false }),
      mission({ goals: [{ opcode: 'IfMissionIsActive', missionIndex: 0 }] }),
    ]);
    sim.run(FIRST_PASS);
    expect(records(sim)[1]?.evaluated).toBe(false);
  });
});

describe('RandomTimeGone', () => {
  it('draws once per activation, inside [n/2, n) seconds', () => {
    const seconds = 40;
    const fireTicks = [1, 2, 3, 4, 5].map((seed) => {
      const sim = missionSim([mission({ goals: [{ opcode: 'RandomTimeGone', seconds }] })], seed);
      return runUntil(sim, 2000, (s) => records(s)[0]?.active === false);
    });
    for (const fired of fireTicks) {
      // Quantised to the cadence, and counted from the tick-1 activation.
      expect(fired % MISSION_EVALUATION_TICKS).toBe(0);
      expect(fired).toBeGreaterThanOrEqual((seconds / 2) * TICKS_PER_SECOND);
      expect(fired).toBeLessThan(seconds * TICKS_PER_SECOND + MISSION_EVALUATION_TICKS + 1);
    }
    expect(new Set(fireTicks).size).toBeGreaterThan(1); // the draw actually varies with the seed
  });

  it('fires at once for a span too short to draw from', () => {
    const sim = missionSim([mission({ goals: [{ opcode: 'RandomTimeGone', seconds: 1 }] })]);
    sim.run(FIRST_PASS);
    expect(records(sim)[0]?.active).toBe(false);
  });

  it('draws again on every check once the span has passed but the mission has not fired', () => {
    // The span is cleared the moment it elapses, not when the mission fires, so a goal held back by
    // a second goal keeps redrawing - and keeps consuming the shared generator. The original clears
    // its cache on the same edge.
    const sim = missionSim([
      mission({
        goals: [
          { opcode: 'RandomTimeGone', seconds: 4 },
          { opcode: 'IfMissionIsActive', missionIndex: 1 },
        ],
      }),
      mission({ active: false }),
    ]);
    sim.run(FIRST_PASS * 4);
    expect(records(sim)[0]?.active).toBe(true); // the second goal never held, so it never fired
    const drawn = new Set<number>();
    for (let pass = 0; pass < 6; pass++) {
      sim.run(MISSION_EVALUATION_TICKS);
      drawn.add(records(sim)[0]?.randomSeconds[0] ?? -1);
    }
    // Cleared on every pass because the span is long past; a latched draw would hold one value.
    expect([...drawn]).toEqual([0]);
  });

  it('draws again on the next activation', () => {
    const sim = missionSim([
      mission({
        goals: [{ opcode: 'RandomTimeGone', seconds: 40 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 0 }],
      }),
    ]);
    const first = runUntil(sim, 2000, (s) => records(s)[0]?.randomSeconds[0] === 0);
    // Cleared as it fired, and the mission re-activated itself, so the next pass draws a fresh span.
    const second = runUntil(sim, 2000, (s) => records(s)[0]?.randomSeconds[0] === 0 && s.tick > first);
    expect(second).toBeGreaterThan(first);
  });
});

describe('an opcode this build cannot run', () => {
  it('reports it once per mission and treats the goal as not held', () => {
    const sim = missionSim([
      mission({
        goals: [{ opcode: 'BuildVehicles', player: 0, vehicleType: 1, amount: 1, vehicleId: 7 }],
        results: [{ opcode: 'Exit' }],
      }),
    ]);
    sim.run(FIRST_PASS);
    expect(eventsOfKind(sim, 'missionUnsupported')).toEqual([
      { kind: 'missionUnsupported', mission: 0, opcode: 'BuildVehicles' },
    ]);
    expect(records(sim)[0]?.active).toBe(true);
    sim.run(FIRST_PASS);
    expect(eventsOfKind(sim, 'missionUnsupported')).toEqual([]);
  });

  it('reports an unsupported result and keeps running the rest of them', () => {
    const sim = missionSim([
      mission({
        goals: [TRUE_GOAL],
        results: [
          { opcode: 'SetVertexColor', point: { hx: 0, hy: 0 }, range: 1, amount: 1 },
          { opcode: 'Exit' },
        ],
      }),
    ]);
    sim.run(FIRST_PASS);
    expect(eventsOfKind(sim, 'missionUnsupported')).toEqual([
      { kind: 'missionUnsupported', mission: 0, opcode: 'SetVertexColor' },
    ]);
    expect(eventsOfKind(sim, 'missionExit')).toHaveLength(1);
  });
});
