import { describe, expect, it } from 'vitest';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type SaveGame,
  serializeSaveGame,
} from '../../src/index.js';
import { MAX_SUBMISSION_DEPTH } from '../../src/save/parse.js';
import { MISSION_EVALUATION_TICKS, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { firingSim, MAP_NODES, missionSim } from './support.js';

describe('sub-mission transitions', () => {
  it('finishes results and later missions before requesting the new world, then resumes without retriggering', () => {
    const sim = missionSim([
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [
          { opcode: 'StartSubMission', campaignId: 0, mapId: 91 },
          { opcode: 'ActivateMission', missionIndex: 1 },
        ],
      },
      {
        active: false,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetExternalFlag', player: 0, flagId: 3, flag: true }],
      },
    ]);
    sim.run(MISSION_EVALUATION_TICKS);
    expect(sim.events.current()).toContainEqual({
      kind: 'missionSubMission',
      transition: { kind: 'start', campaignId: 0, mapId: 91, mission: 0 },
    });
    expect(sim.missionStatus().map((m) => m.fireCount)).toEqual([1, 1]);
    const parent = exportSaveGame(sim, { mapId: 'parent' });
    const child = firingSim([{ opcode: 'EndSubMission' }]);
    child.run(MISSION_EVALUATION_TICKS);
    const saved = parseSaveGame(
      JSON.parse(serializeSaveGame(exportSaveGame(child, { mapId: 'child', parent }))),
    );
    expect(saved.parent).toEqual(parent);
    if (saved.parent === undefined) throw new Error('missing parent');
    const restored = restoreSimulation(saved.parent, {
      content: sim.content,
      map: grassNodeMap(MAP_NODES, MAP_NODES),
      ...(sim.missions !== undefined ? { missions: sim.missions } : {}),
    }).sim;
    expect(exportSaveGame(restored, { mapId: 'parent' })).toEqual(parent);
    restored.run(MISSION_EVALUATION_TICKS);
    expect(restored.events.current().some((e) => e.kind === 'missionSubMission')).toBe(false);
  });

  it.each([true, false])('EndSubMission takes precedence regardless of result order (%s)', (endFirst) => {
    const start = { opcode: 'StartSubMission', campaignId: 1, mapId: 2 } as const;
    const end = { opcode: 'EndSubMission' } as const;
    const sim = firingSim(endFirst ? [end, start] : [start, end]);
    sim.run(MISSION_EVALUATION_TICKS);
    expect(sim.events.current()).toContainEqual({
      kind: 'missionSubMission',
      transition: { kind: 'end', mission: 0 },
    });
  });

  it('rejects cyclic and excessively nested parent envelopes', () => {
    const base = exportSaveGame(firingSim([]));
    const cyclic: { parent?: unknown } = { ...base };
    cyclic.parent = cyclic;
    expect(() => parseSaveGame(cyclic)).toThrow('nesting limit');
    let save: SaveGame = base;
    for (let i = 0; i <= MAX_SUBMISSION_DEPTH; i++) save = { ...base, parent: save };
    expect(() => parseSaveGame(save)).toThrow('nesting limit');
  });
});
