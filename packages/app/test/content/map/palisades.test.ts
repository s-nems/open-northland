import type { TerrainObjects } from '@open-northland/data';
import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { mapPalisadeSpawns, spawnMapPalisades } from '../../../src/content/map/palisades.js';

const IR: ContentIr = {
  landscape: [
    {
      typeId: 82,
      id: 'wall',
      maxValency: 100,
      playerIdAllowed: true,
      transitions: [
        [9, 82, 2, 3, 0],
        [10, 82, 2, -1, 0],
      ],
    },
  ],
  landscapeGfx: [{ index: 691, editName: 'wall_01', logicType: 82 }],
};

describe('map palisade promotion', () => {
  it('preserves source player zero and high player slots while leaving neutral walls unowned', () => {
    // A post's authored level scales with its one and a half pools, a hundred hitpoints a point.
    const objects: TerrainObjects = {
      types: ['wall_01'],
      placements: [2, 4, 0, 3, 4, 0, 4, 4, 0],
      owners: [0, 12, null],
      levels: [100, 40, 60],
    };

    expect(mapPalisadeSpawns(objects, IR)).toEqual([
      { gfxIndex: 691, hx: 2, hy: 4, placement: 0, owner: 0, hitpoints: 15_000 },
      { gfxIndex: 691, hx: 3, hy: 4, placement: 1, owner: 12, hitpoints: 6000 },
      { gfxIndex: 691, hx: 4, hy: 4, placement: 2, owner: undefined, hitpoints: 9000 },
    ]);
  });

  it("scales a gate's authored level by its closed cells, as its hitpoints are, open or closed", () => {
    const gateIr: ContentIr = {
      landscape: [
        {
          typeId: 83,
          id: 'wall_gate_closed',
          maxValency: 100,
          playerIdAllowed: true,
          transitions: [
            [9, 83, 2, 1, 0],
            [10, 83, 2, -1, 0],
          ],
        },
        {
          typeId: 84,
          id: 'wall_gate_open',
          maxValency: 100,
          playerIdAllowed: true,
          transitions: [
            [9, 84, 2, 1, 0],
            [10, 84, 2, -1, 0],
          ],
        },
      ],
      landscapeGfx: [
        { index: 697, editName: 'gate_02', logicType: 83, walkBlockAreas: [[1, -2, 0, 5]] },
        {
          index: 701,
          editName: 'gate_02_open',
          logicType: 84,
          walkBlockAreas: [
            [1, -2, 0, 1],
            [1, 2, 0, 1],
          ],
        },
      ],
    };
    const objects: TerrainObjects = {
      types: ['gate_02', 'gate_02_open'],
      placements: [2, 4, 0, 6, 4, 1],
      owners: [0, 0],
      levels: [70, 70],
    };

    // An open gate blocks two cells but scales by its closed pair's five.
    expect(mapPalisadeSpawns(objects, gateIr)).toEqual([
      { gfxIndex: 697, hx: 2, hy: 4, placement: 0, owner: 0, hitpoints: 35_000 },
      { gfxIndex: 701, hx: 6, hy: 4, placement: 1, owner: 0, hitpoints: 35_000 },
    ]);
  });

  it('uses each owner roster tribe and passes authored durability and placement to trusted placement', () => {
    const commands: Command[] = [];
    const sim = {
      enqueueSetup: (command: Command): void => {
        commands.push(command);
      },
    };
    const objects: TerrainObjects = {
      types: ['wall_01'],
      placements: [2, 4, 0, 3, 4, 0],
      owners: [0, 12],
      levels: [100, 40],
    };

    spawnMapPalisades(sim, objects, IR, (owner) => (owner === 12 ? 7 : 1));

    expect(commands).toEqual([
      {
        kind: 'placePalisade',
        gfxIndex: 691,
        x: 2,
        y: 4,
        tribe: 1,
        owner: 0,
        hitpoints: 15_000,
        landscapeId: 0,
        underConstruction: false,
        force: true,
      },
      {
        kind: 'placePalisade',
        gfxIndex: 691,
        x: 3,
        y: 4,
        tribe: 7,
        owner: 12,
        hitpoints: 6000,
        landscapeId: 1,
        underConstruction: false,
        force: true,
      },
    ]);
  });

  it("leaves an absent seat's walls unplaced but still claims their placements", () => {
    const commands: Command[] = [];
    const sim = { enqueueSetup: (command: Command): void => void commands.push(command) };
    const objects: TerrainObjects = {
      types: ['wall_01'],
      placements: [2, 4, 0, 3, 4, 0],
      owners: [0, 12],
    };
    const placements = spawnMapPalisades(sim, objects, IR, () => 1, new Set([0]));
    expect(commands.map((command) => (command.kind === 'placePalisade' ? command.owner : null))).toEqual([
      12,
    ]);
    expect(placements).toHaveLength(2);
  });
});
