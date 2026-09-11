import type { TerrainMapFile } from '@open-northland/data';
import { exportSaveGame, type MissionScript, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../src/entries/map/world.js';

it('fresh and restored map worlds share editable landscape input and saved terrain changes', () => {
  const map: TerrainMapFile = {
    width: 12,
    height: 12,
    typeIds: new Array<number>(144).fill(0),
    objects: { types: ['block'], placements: [12, 12, 0] },
  };
  const ir: ContentIr = {
    landscapeGfx: [
      {
        index: 7,
        logicType: 1,
        editName: 'block',
        walkBlockAreas: [[1, 0, 0, 1]],
        buildBlockAreas: [[1, 0, 0, 1]],
      },
    ],
  };
  const missions: MissionScript = {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: 0,
        goals: [],
        results: [
          { opcode: 'RemoveLandscape', point: { hx: 12, hy: 12 } },
          { opcode: 'SetVertexColor', point: { hx: 12, hy: 12 }, range: 2, amount: 64 },
          { opcode: 'SetHouseBuildForbiddenArea', point: { hx: 12, hy: 12 }, range: 2, flag: true },
        ],
      },
    ],
  };
  const options = {
    seed: 7,
    map,
    ir,
    content: {},
    aiSeats: [],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    missions: true,
    script: { missions },
  };
  const { sim } = buildMapWorld(options);
  expect(sim.terrain?.landscapes?.placements).toHaveLength(1);
  sim.run(systems.MISSION_EVALUATION_TICKS);
  expect(sim.landscapeEdits().removed).toEqual([0]);
  expect(sim.landscapeEdits().tints.length).toBeGreaterThan(0);
  const { sim: restored } = restoreMapWorld(options, exportSaveGame(sim));
  expect(restored.hashState()).toBe(sim.hashState());
  expect(restored.landscapeEdits()).toEqual({
    ...sim.landscapeEdits(),
    revision: restored.landscapeRevision,
  });
  const buildingType = sim.content.buildings[0]?.typeId;
  if (buildingType === undefined) throw new Error('fixture has no building');
  expect(restored.placementProbe(buildingType)?.canPlace(12, 12)).toBe(false);
  sim.run(systems.MISSION_EVALUATION_TICKS);
  restored.run(systems.MISSION_EVALUATION_TICKS);
  expect(restored.hashState()).toBe(sim.hashState());
});
