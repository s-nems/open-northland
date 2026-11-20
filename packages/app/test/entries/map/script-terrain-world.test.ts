import type { TerrainMapFile } from '@open-northland/data';
import { NO_RULE_OVERRIDES } from '@open-northland/lockstep';
import { exportSaveGame, type MissionScript, SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../../../src/entries/map/world.js';

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
        successfullIf: SUCCESSFUL_IF.all,
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
    machineSeats: [],
    assistantSeats: [],
    ...NO_RULE_OVERRIDES,
    missions: true,
    script: { missions },
  };
  const { sim } = buildMapWorld(options);
  expect(sim.terrain?.landscapes?.placements).toHaveLength(1);
  sim.run(systems.MISSION_EVALUATION_TICKS);
  expect(sim.landscapeEdits().removed).toEqual([0]);
  expect(sim.landscapeEdits().tints.some((value) => value !== 0)).toBe(true);
  const { sim: restored } = restoreMapWorld(options, exportSaveGame(sim));
  expect(restored.hashState()).toBe(sim.hashState());
  expect(restored.landscapeEdits()).toEqual({
    ...sim.landscapeEdits(),
    revision: restored.landscapeEdits().revision,
  });
  const buildingType = sim.content.buildings[0]?.typeId;
  if (buildingType === undefined) throw new Error('fixture has no building');
  expect(restored.placementProbe(buildingType)?.canPlace(12, 12)).toBe(false);
  sim.run(systems.MISSION_EVALUATION_TICKS);
  restored.run(systems.MISSION_EVALUATION_TICKS);
  expect(restored.hashState()).toBe(sim.hashState());
});

it('razes an authored wall a script removes from the landscape', () => {
  const map: TerrainMapFile = {
    width: 12,
    height: 12,
    typeIds: new Array<number>(144).fill(0),
    objects: { types: ['wall_01'], placements: [12, 12, 0], levels: [100] },
  };
  const wallLogicType = 82;
  const ir: ContentIr = {
    landscape: [
      {
        typeId: wallLogicType,
        id: 'wall',
        maxValency: 100,
        playerIdAllowed: true,
        transitions: [
          [9, wallLogicType, 2, 3, 0],
          [10, wallLogicType, 2, -1, 0],
        ],
      },
    ],
    landscapeGfx: [
      {
        index: 691,
        logicType: wallLogicType,
        editName: 'wall_01',
        walkBlockAreas: [[1, 0, 0, 1]],
        buildBlockAreas: [[1, 0, 0, 1]],
      },
    ],
  };
  const removal: MissionScript = {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'RemoveLandscape', point: { hx: 12, hy: 12 } }],
      },
    ],
  };
  const { sim } = buildMapWorld({
    seed: 7,
    map,
    ir,
    content: {},
    machineSeats: [],
    assistantSeats: [],
    ...NO_RULE_OVERRIDES,
    missions: true,
    script: { missions: removal },
  });
  const walls = (): number =>
    sim.snapshot().entities.filter((e) => e.components.Palisade !== undefined).length;
  expect(walls()).toBe(1);
  sim.run(systems.MISSION_EVALUATION_TICKS);
  expect(walls()).toBe(0);
  expect(sim.landscapeEdits().removed).toEqual([0]);
});
