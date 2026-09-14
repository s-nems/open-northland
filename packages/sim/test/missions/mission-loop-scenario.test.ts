import { describe, expect, it } from 'vitest';
import { Health, missionRecords, playerTally } from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  scenario,
  serializeSaveGame,
} from '../../src/index.js';
import {
  MISSION_EVALUATION_TICKS,
  type MissionResultOp,
  type MissionScript,
  missionObjects,
  SUCCESSFUL_IF,
} from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * A headless run of the script shape the corpus uses for timed waves: a mission that re-activates
 * itself off a `RandomTimeGone` goal, so every firing draws again from the seeded generator. It is the
 * whole engine end to end - cadence, activation clock, RNG draw, and the state a save carries.
 */

const RUN_TICKS = MISSION_EVALUATION_TICKS * 40;

/** Where the wave script below puts its group - a plain grass node well inside its map. */
const WAVE_POINT = { hx: 12, hy: 12 };

/** Mission 0 loops on a random timer and flips mission 1's visibility, so the pass writes state a
 *  hash and a save both have to carry. */
const LOOP: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [{ opcode: 'RandomTimeGone', seconds: 30 }],
      results: [
        { opcode: 'SetVisible', missionIndex: 1, flag: true },
        { opcode: 'ActivateMission', missionIndex: 0 },
      ],
    },
    { successfullIf: SUCCESSFUL_IF.all, active: false, visible: false, goals: [], results: [] },
  ],
};

/** The ticks the looping mission fired on, read off its activation clock as the run advances. */
function fireTicks(seed: number, ticks: number): { fired: number[]; hash: string } {
  const run = scenario(testContent(), { seed, missions: LOOP })
    .command({ kind: 'setMissionsEnabled', enabled: true })
    .run(0);
  const fired: number[] = [];
  let lastActivation = -1;
  for (let i = 0; i < ticks; i++) {
    run.sim.step();
    const activation = missionRecords(run.sim.world)[0]?.activationTick ?? -1;
    if (activation !== lastActivation) {
      if (lastActivation >= 0) fired.push(activation);
      lastActivation = activation;
    }
  }
  return { fired, hash: run.sim.hashState() };
}

describe('a self-re-activating mission on a random timer', () => {
  it('fires on the same ticks and reaches the same state on the same seed', () => {
    const first = fireTicks(7, RUN_TICKS);
    const second = fireTicks(7, RUN_TICKS);
    expect(first.fired.length).toBeGreaterThan(2); // the loop really looped
    expect(second.fired).toEqual(first.fired);
    expect(second.hash).toBe(first.hash);
  });

  it('draws a different schedule from a different seed', () => {
    expect(fireTicks(9, RUN_TICKS).fired).not.toEqual(fireTicks(7, RUN_TICKS).fired);
  });

  it('continues the same loop after a save and restore mid-cycle', () => {
    const live = scenario(testContent(), { seed: 7, missions: LOOP })
      .command({ kind: 'setMissionsEnabled', enabled: true })
      .run(RUN_TICKS / 2).sim;
    const bytes = serializeSaveGame(exportSaveGame(live, { mapId: 'mission-loop' }));
    const { sim: restored } = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: testContent(),
      // Mission definitions are content, so the restore is handed the script the run was built with.
      missions: LOOP,
    });
    expect(restored.hashState()).toBe(live.hashState());
    live.run(RUN_TICKS / 2);
    restored.run(RUN_TICKS / 2);
    expect(restored.hashState()).toBe(live.hashState());
    expect(missionRecords(restored.world)).toEqual(missionRecords(live.world));
  });

  it('refuses a restore whose script is not the one the save was taken on', () => {
    const live = scenario(testContent(), { seed: 7, missions: LOOP })
      .command({ kind: 'setMissionsEnabled', enabled: true })
      .run(MISSION_EVALUATION_TICKS).sim;
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(live, { mapId: 'loop' }))));
    // The records are positional, so a shorter script - or none at all - would run the saved state
    // against other missions entirely.
    expect(() => restoreSimulation(save, { content: testContent() })).toThrow(/mission records/);
    expect(() =>
      restoreSimulation(save, { content: testContent(), missions: { missions: LOOP.missions.slice(1) } }),
    ).toThrow(/mission records/);
  });
});

/** The other shape the corpus uses: a wave that spawns a group, counts it, numbers what it counted
 *  and clears it away again, in one script. */
const SPAWN_GROUP: MissionResultOp = {
  opcode: 'SetHumanX',
  player: 2,
  tribe: 1,
  job: 1,
  point: WAVE_POINT,
  humanId: 50,
  behaviour: 0,
  amount: 4,
};

const WAVE: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [],
      results: [SPAWN_GROUP, { opcode: 'ActivateMission', missionIndex: 1 }],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: false,
      visible: false,
      goals: [{ opcode: 'BuildHumans', player: 2, job: 1, amount: 4, humanId: 51 }],
      results: [{ opcode: 'RemoveHumans', humanId: 51 }],
    },
  ],
};

/** The lattice the wave runs on; the restore has to be handed the same one. */
const WAVE_MAP = grassNodeMap(32, 32);

/** The wave's first half alone, so the group is still standing when the test kills one of them. */
const SPAWN_ONLY: MissionScript = {
  missions: [
    { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results: [SPAWN_GROUP] },
  ],
};

function waveSim(seed: number, missions: MissionScript): Simulation {
  return scenario(testContent(), { seed, map: WAVE_MAP, missions })
    .command({ kind: 'setMissionsEnabled', enabled: true })
    .run(MISSION_EVALUATION_TICKS).sim;
}

describe('a wave that spawns, numbers and clears a group', () => {
  it('reaches the same state twice on the same seed', () => {
    const first = waveSim(3, WAVE);
    const second = waveSim(3, WAVE);
    expect(first.hashState()).toBe(second.hashState());
    // The whole script really ran: the group was spawned, re-numbered by the goal, then removed.
    expect(missionObjects(first.world, 50)).toHaveLength(0);
    expect(missionObjects(first.world, 51)).toHaveLength(0);
  });

  it('carries the player tallies through a save and restore', () => {
    const live = waveSim(3, SPAWN_ONLY);
    // A death the script did not cause, so the tallies hold something a save has to carry.
    const victim = missionObjects(live.world, 50)[0];
    if (victim === undefined) throw new Error('the wave spawned nobody');
    live.world.mut(victim, Health).hitpoints = 0;
    live.run(1);
    expect(playerTally(live.world, 2).humansDied).toBe(1);

    const bytes = serializeSaveGame(exportSaveGame(live, { mapId: 'mission-wave' }));
    const { sim: restored } = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: testContent(),
      map: WAVE_MAP,
      missions: SPAWN_ONLY,
    });
    expect(playerTally(restored.world, 2)).toEqual(playerTally(live.world, 2));
    expect(restored.hashState()).toBe(live.hashState());
  });
});
