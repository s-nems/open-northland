import { GfxPattern, TerrainMapFile, TrianglePatternType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../src/catalog/terrain.js';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildScriptLandscapeTerrain, scriptLandscapeTypes } from '../src/content/script-landscape.js';

const IR: ContentIr = {
  landscape: [
    { typeId: 85, id: 'chest_wooden' },
    { typeId: 86, id: 'chest_magical' },
  ],
  landscapeGfx: [
    {
      index: 12,
      editName: 'block',
      logicType: 1,
      walkBlockAreas: [[1, 0, 0, 1]],
      buildBlockAreas: [[1, -1, 0, 3]],
    },
    { index: 13, editName: 'fx smoke', logicType: 1 },
    { index: 14, editName: 'fx fire small', logicType: 1 },
    { index: 15, editName: 'fx wave', logicType: 1 },
    { index: 16, editName: 'similar block decor', logicType: 1 },
    { index: 17, editName: 'test stone', logicType: 15, maxValency: 23 },
    { index: 18, editName: 'test berries', logicType: 11 },
    { index: 19, editName: 'chest wooden', logicType: 85 },
    { index: 20, editName: 'chest magical', logicType: 86 },
  ],
  gatheringPipeline: [{ goodType: 9, goodId: 'stone', harvest: { landscapeType: 15, gfxIndices: [17] } }],
};

describe('script landscape content', () => {
  it('classifies explicit graphics without conflating their shared void logic type', () => {
    const types = scriptLandscapeTypes(IR);
    expect(types.map((t) => [t.typeId, t.groups])).toEqual([
      [12, ['blocker']],
      [13, ['fx1', 'fx2', 'smoke']],
      [14, ['fx1', 'fx2']],
      [15, ['wave']],
      [16, []],
      [17, []],
      [18, []],
      [19, []],
      [20, []],
    ]);
    expect(types[0]?.walk).toEqual([{ dx: 0, dy: 0 }]);
    expect(types[0]?.build).toEqual([
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    expect(types[5]?.resource).toMatchObject({
      gfxIndex: 17,
      remaining: 23,
      deposit: { initial: 23, levels: 23 },
    });
    expect(types[5]?.resource).not.toHaveProperty('x');
    expect(types[6]?.bushGfxIndex).toBe(18);
    expect(types[7]?.chest).toEqual({ kind: 'wooden', gfxIndex: 19 });
    expect(types[8]?.chest).toEqual({ kind: 'magical', gfxIndex: 20 });
  });

  it('keeps ground unblocked and preserves placement ids, levels and resource ownership', () => {
    const map = TerrainMapFile.parse({
      width: 2,
      height: 2,
      typeIds: [1, 1, 1, 1],
      objects: {
        types: ['missing', 'block', 'test stone', 'test berries', 'chest wooden'],
        placements: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 2, 1, 4],
        levels: [1, 4, 2, 1, 52],
      },
    });
    const before = JSON.stringify(map);
    const terrain = buildScriptLandscapeTerrain(map, IR);
    expect(terrain.typeIds).toEqual(new Array(16).fill(TERRAIN_OPEN));
    expect(terrain.landscapes?.placements).toEqual([
      { id: 1, typeId: 12, hx: 1, hy: 1, level: 4 },
      { id: 2, typeId: 17, hx: 2, hy: 2, level: 2, resourceBacked: true },
      { id: 3, typeId: 18, hx: 3, hy: 3, level: 1, resourceBacked: true },
      { id: 4, typeId: 19, hx: 2, hy: 1, level: 52, resourceBacked: true },
    ]);
    expect(JSON.stringify(map)).toBe(before);
  });

  it('marks only confirmed dry cells for land-only vertex colors', () => {
    const map = TerrainMapFile.parse({
      width: 3,
      height: 1,
      typeIds: [1, 1, 1],
      ground: {
        patterns: ['dry', 'wet', 'unknown'],
        a: [0, 0, 2],
        b: [0, 1, 2],
      },
    });
    const ir: ContentIr = {
      ...IR,
      gfxPatterns: [
        GfxPattern.parse({ id: 1, editName: 'dry', logicType: 2 }),
        GfxPattern.parse({ id: 2, editName: 'wet', logicType: 1 }),
      ],
      trianglePatternTypes: [
        TrianglePatternType.parse({ type: 2, isWater: false }),
        TrianglePatternType.parse({ type: 1, isWater: true }),
      ],
    };
    expect(buildScriptLandscapeTerrain(map, ir).landVertices).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('script landscape walls', () => {
  const WOOD = 5;
  const wallRow = (typeId: number, id: string, step: number, playerIdAllowed = true) => ({
    typeId,
    id,
    maxValency: 100,
    playerIdAllowed,
    transitions: [
      [9, typeId, 2, step, 0],
      [10, typeId, 2, -1, 0],
    ],
  });
  const wallIr = (playerIdAllowed: boolean): ContentIr => ({
    goods: [{ typeId: WOOD, id: 'wood' }],
    landscape: [
      wallRow(82, 'wall', 3, playerIdAllowed),
      wallRow(83, 'wall_gate_closed', 1, playerIdAllowed),
      wallRow(84, 'wall_gate_open', 1, playerIdAllowed),
    ],
    landscapeGfx: [
      { index: 691, editName: 'wall_01', logicType: 82 },
      { index: 696, editName: 'gate_01', logicType: 83 },
      { index: 700, editName: 'gate_01_open', logicType: 84 },
    ],
  });

  it('joins the player wall rows to their hitpoints, repair steps, gate pairs and wood', () => {
    expect(scriptLandscapeTypes(wallIr(true)).map((t) => t.wall)).toEqual([
      { logicType: 82, maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: WOOD, amount: 1 }] },
      {
        logicType: 83,
        maxHitpoints: 100,
        repairPerStrike: 1,
        construction: [{ goodType: WOOD, amount: 1 }],
        gate: { open: false, counterpartGfxIndex: 700 },
      },
      {
        logicType: 84,
        maxHitpoints: 100,
        repairPerStrike: 1,
        construction: [{ goodType: WOOD, amount: 1 }],
        gate: { open: true, counterpartGfxIndex: 696 },
      },
    ]);
  });

  it('leaves wall rows no player may own as scenery', () => {
    expect(scriptLandscapeTypes(wallIr(false)).map((t) => t.wall)).toEqual([undefined, undefined, undefined]);
  });
});
