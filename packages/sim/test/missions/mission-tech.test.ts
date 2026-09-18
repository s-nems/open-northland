import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  grantScriptUnlock,
  missionRecords,
  ScriptUnlocks,
  scriptAllows,
  scriptEnables,
} from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  scenario,
  serializeSaveGame,
} from '../../src/index.js';
import type { MissionDefinition, MissionResultOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { buildingEnabled, goodEnabled, jobEnabled } from '../../src/systems/progression/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import {
  CARPENTER,
  FRANK,
  firingSim,
  holds,
  LOAD_PASS,
  missionSim,
  spawn,
  VIKING,
  WOODCUTTER,
} from './support.js';

/**
 * The unlock tables a script writes and the gates that read them. The fixture gates the plank on a
 * living woodcutter and house 4 on a living carpenter; `techContent` adds the one edge it lacks, a
 * carpenter that only a woodcutter's presence opens.
 */

const PLANK = 2;
const GATED_HOUSE = 4;
const OWNER = 0;
const RIVAL = 1;

function techContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    tribes: base.tribes.map((t) =>
      t.typeId === VIKING
        ? { ...t, jobEnables: [...t.jobEnables, { jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER }] }
        : t,
    ),
  });
}

function firing(result: MissionResultOp): MissionDefinition {
  return { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results: [result] };
}

describe('EnableGood', () => {
  it('makes the good produceable for that player and tribe, and no other', () => {
    const sim = firingSim([{ opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK }]);
    sim.run(LOAD_PASS);
    const ctx = ctxOf(sim);
    expect(goodEnabled(sim.world, ctx, OWNER, VIKING, PLANK)).toBe(true);
    expect(goodEnabled(sim.world, ctx, RIVAL, VIKING, PLANK)).toBe(false);
    // The table is keyed by tribe as well: a Frank of the same seat got nothing (its gate stays the
    // living-trade rule, which the fixture leaves open for that civilization).
    expect(scriptEnables(sim.world, OWNER, FRANK, 'good', PLANK)).toBe(false);
    expect(goodEnabled(sim.world, ctx, undefined, VIKING, PLANK)).toBe(false);
    expect(scriptEnables(sim.world, OWNER, VIKING, 'good', PLANK)).toBe(true);
    expect(scriptAllows(sim.world, OWNER, VIKING, 'good', PLANK)).toBe(false);
  });

  it('is what the GoodProduceable goal reads, beside the living-trade rule', () => {
    const scripted = missionSim([
      firing({ opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK }),
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [{ opcode: 'GoodProduceable', player: OWNER, tribe: VIKING, good: PLANK }],
        results: [],
      },
    ]);
    scripted.run(LOAD_PASS);
    expect(missionRecords(scripted.world)[1]?.evaluated).toBe(true);

    const goal = { opcode: 'GoodProduceable', player: OWNER, tribe: VIKING, good: PLANK } as const;
    const bare = missionSim([
      { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] },
    ]);
    bare.run(LOAD_PASS);
    expect(holds(bare)).toBe(false);

    const earned = missionSim([
      { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] },
    ]);
    spawn(earned, { player: OWNER, job: WOODCUTTER });
    earned.run(LOAD_PASS);
    expect(holds(earned)).toBe(true);
  });
});

describe('AllowGood', () => {
  it('records permission without unlocking anything', () => {
    const sim = firingSim([{ opcode: 'AllowGood', player: OWNER, tribe: VIKING, good: PLANK }]);
    sim.run(LOAD_PASS);
    expect(scriptAllows(sim.world, OWNER, VIKING, 'good', PLANK)).toBe(true);
    expect(goodEnabled(sim.world, ctxOf(sim), OWNER, VIKING, PLANK)).toBe(false);
  });
});

describe('EnableJob and JobEnabled', () => {
  const goal = { opcode: 'JobEnabled', player: OWNER, tribe: VIKING, job: CARPENTER } as const;

  it('holds for a trade no edge gates, and for a gated one only once its enabler lives or the script enables it', () => {
    const open = missionSim([
      { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] },
    ]);
    open.run(LOAD_PASS);
    expect(holds(open)).toBe(true);

    const gated = missionSim(
      [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] }],
      techContent(),
    );
    gated.run(LOAD_PASS);
    expect(holds(gated)).toBe(false);

    const lived = missionSim(
      [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] }],
      techContent(),
    );
    spawn(lived, { player: OWNER, job: WOODCUTTER });
    lived.run(LOAD_PASS);
    expect(holds(lived)).toBe(true);

    const scripted = missionSim(
      [
        firing({ opcode: 'EnableJob', player: OWNER, tribe: VIKING, job: CARPENTER }),
        { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] },
      ],
      techContent(),
    );
    scripted.run(LOAD_PASS);
    expect(missionRecords(scripted.world)[1]?.evaluated).toBe(true);
    expect(jobEnabled(scripted.world, ctxOf(scripted), RIVAL, VIKING, CARPENTER)).toBe(false);
  });
});

describe('EnableHouse and AllowHouse', () => {
  it('land in the tables the building gate reads', () => {
    const sim = firingSim([
      { opcode: 'EnableHouse', player: OWNER, tribe: VIKING, houseType: GATED_HOUSE },
      { opcode: 'AllowHouse', player: OWNER, tribe: VIKING, houseType: GATED_HOUSE },
      { opcode: 'AllowJob', player: OWNER, tribe: VIKING, job: CARPENTER },
    ]);
    sim.run(LOAD_PASS);
    expect(scriptEnables(sim.world, OWNER, VIKING, 'house', GATED_HOUSE)).toBe(true);
    expect(scriptAllows(sim.world, OWNER, VIKING, 'house', GATED_HOUSE)).toBe(true);
    expect(scriptAllows(sim.world, OWNER, VIKING, 'job', CARPENTER)).toBe(true);
    expect(scriptEnables(sim.world, OWNER, VIKING, 'job', CARPENTER)).toBe(false);
    expect(buildingEnabled(sim.world, ctxOf(sim), OWNER, VIKING, GATED_HOUSE)).toBe(true);
  });
});

describe('the unlock tables', () => {
  it('keep one ascending entry per grant however the lines were ordered', () => {
    const a = firingSim([
      { opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: 7 },
      { opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK },
      { opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK },
    ]);
    const b = firingSim([
      { opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK },
      { opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: 7 },
    ]);
    a.run(LOAD_PASS);
    b.run(LOAD_PASS);
    const tables = (sim: typeof a) => {
      const e = sim.world.lowestEntityWith(ScriptUnlocks);
      return e === null ? undefined : sim.world.get(e, ScriptUnlocks).byPlayer.get(OWNER)?.get(VIKING);
    };
    expect(tables(a)?.enabled.good).toEqual([PLANK, 7]);
    expect(tables(b)).toEqual(tables(a));
  });

  it('ignore a slot the sim does not seat', () => {
    const sim = firingSim([{ opcode: 'EnableGood', player: 20, tribe: VIKING, good: PLANK }]);
    sim.run(LOAD_PASS);
    expect(sim.world.lowestEntityWith(ScriptUnlocks)).toBeNull();
    grantScriptUnlock(sim.world, 'enabled', -1, VIKING, 'good', PLANK);
    expect(sim.world.lowestEntityWith(ScriptUnlocks)).toBeNull();
  });

  it('survive a save and restore', () => {
    const script = [firing({ opcode: 'EnableGood', player: OWNER, tribe: VIKING, good: PLANK })];
    const live = scenario(testContent(), { seed: 3, missions: { missions: script } })
      .command({ kind: 'setMissionsEnabled', enabled: true })
      .run(LOAD_PASS).sim;
    const bytes = serializeSaveGame(exportSaveGame(live, { mapId: 'mission-tech' }));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: testContent(),
      missions: { missions: script },
    });
    expect(restored.hashState()).toBe(live.hashState());
    expect(goodEnabled(restored.world, ctxOf(restored), OWNER, VIKING, PLANK)).toBe(true);
  });
});
