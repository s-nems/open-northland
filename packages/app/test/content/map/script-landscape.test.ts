import {
  GfxPattern,
  GROUND_LAND,
  GROUND_VOID,
  GROUND_WATER,
  TerrainMapFile,
  TrianglePatternType,
} from '@open-northland/data';
import { LandscapePlacements } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../../src/catalog/terrain.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import {
  buildScriptLandscapeTerrain,
  scriptLandscapeTypes,
} from '../../../src/content/map/script-landscape.js';

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
    { index: 18, editName: 'bush 01 fruits', logicType: 11 },
    { index: 19, editName: 'chest wooden', logicType: 85 },
    { index: 20, editName: 'chest magical', logicType: 86 },
    { index: 21, editName: 'bush 01 empty', logicType: 9 },
    { index: 22, editName: 'bush 01 flower', logicType: 10 },
  ],
  gatheringPipeline: [{ goodType: 9, goodId: 'stone', harvest: { landscapeType: 15, gfxIndices: [17] } }],
};

describe('script landscape content', () => {
  it('classifies explicit graphics without conflating their shared void logic type', () => {
    const types = scriptLandscapeTypes(IR);
    expect(types.map((t) => [t.typeId, t.groups])).toEqual([
      [12, ['blocker']],
      [13, ['fx2', 'smoke']],
      [14, ['fx2', 'smoke']],
      [15, ['wave']],
      [16, []],
      [17, []],
      [18, []],
      [19, []],
      [20, []],
      [21, []],
      [22, []],
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
    expect(types[6]?.bush).toEqual({ gfxIndex: 18, stage: 'ripe' });
    // A naked or flowering bush draws from its fruited twin and grows on from its own stage.
    expect(types[9]?.bush).toEqual({ gfxIndex: 18, stage: 'bare' });
    expect(types[10]?.bush).toEqual({ gfxIndex: 18, stage: 'flowering' });
    expect(types[7]?.chest).toEqual({ kind: 'wooden', gfxIndex: 19 });
    expect(types[8]?.chest).toEqual({ kind: 'magical', gfxIndex: 20 });
  });

  it("caps a type's level at the lower maximum valency and takes its ground from its logic type", () => {
    const types = scriptLandscapeTypes({
      landscape: [
        { typeId: 40, id: 'pile', maxValency: 6, allowedOnLand: true },
        { typeId: 41, id: 'buoy', maxValency: 2, allowedOnWater: true },
        { typeId: 42, id: 'anything', maxValency: 100, allowedOnEverything: true },
      ],
      landscapeGfx: [
        { index: 0, editName: 'small pile', logicType: 40, maxValency: 5 },
        { index: 1, editName: 'buoy', logicType: 41, maxValency: 9 },
        { index: 2, editName: 'marker', logicType: 42, maxValency: 1 },
        { index: 3, editName: 'unbound', logicType: 43, maxValency: 4 },
      ],
    });
    expect(types.map((t) => [t.typeId, t.maxLevel, t.ground])).toEqual([
      [0, 5, { anywhere: false, land: true, water: false }],
      [1, 2, { anywhere: false, land: false, water: true }],
      [2, 1, { anywhere: true, land: false, water: false }],
      [3, undefined, undefined],
    ]);
  });

  it('expands each attach area row into a run of points east of its offset', () => {
    const [plate] = scriptLandscapeTypes({
      landscapeGfx: [
        {
          index: 0,
          editName: 'triggerplate',
          logicType: 1,
          attachAreas: [
            [-1, -2, 2],
            [3, 0, 1],
          ],
        },
      ],
    });
    expect(plate?.attach).toEqual([
      { dx: -1, dy: -2 },
      { dx: 0, dy: -2 },
      { dx: 3, dy: 0 },
    ]);
  });

  it('keeps ground unblocked and preserves placement ids, levels and resource ownership', () => {
    const map = TerrainMapFile.parse({
      width: 2,
      height: 2,
      typeIds: [1, 1, 1, 1],
      objects: {
        types: ['missing', 'block', 'test stone', 'bush 01 fruits', 'chest wooden'],
        placements: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 2, 1, 4],
        levels: [1, 4, 2, 1, 52],
      },
    });
    const before = JSON.stringify(map);
    const terrain = buildScriptLandscapeTerrain(map, IR);
    expect(terrain.typeIds).toEqual(new Array(16).fill(TERRAIN_OPEN));
    const placements = terrain.landscapes?.placements ?? [];
    const listed =
      placements instanceof LandscapePlacements
        ? Array.from({ length: placements.length }, (_, i) => placements.at(i))
        : placements;
    expect(listed).toEqual([
      { id: 1, typeId: 12, hx: 1, hy: 1, level: 4 },
      { id: 2, typeId: 17, hx: 2, hy: 2, level: 2, resourceBacked: true },
      { id: 3, typeId: 18, hx: 3, hy: 3, level: 1, resourceBacked: true },
      { id: 4, typeId: 19, hx: 2, hy: 1, level: 52, resourceBacked: true },
    ]);
    expect(JSON.stringify(map)).toBe(before);
  });

  it('gives each node its ground kind, water only where every triangle touching it is water', () => {
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
    // Only node (3,0) is touched by the half-wet cell's wet triangle alone. The unknown pattern counts
    // as walkable land; the dry one, which no one walks, as void.
    const V = GROUND_VOID;
    const W = GROUND_WATER;
    const L = GROUND_LAND;
    expect(buildScriptLandscapeTerrain(map, ir).groundKinds).toEqual([V, V, V, W, L, L, V, V, V, L, L, L]);
    const sea = TerrainMapFile.parse({
      width: 2,
      height: 1,
      typeIds: [1, 1],
      ground: { patterns: ['dry', 'wet'], a: [0, 1], b: [1, 1] },
    });
    // The dry triangle claims its apex (0,0) and its west edge's midpoint (0,1); the rest is sea.
    expect(buildScriptLandscapeTerrain(sea, ir).groundKinds).toEqual([V, W, W, W, V, W, W, W]);
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
      { index: 691, editName: 'wall_01', logicType: 82, walkBlockAreas: [[1, 0, 0, 1]] },
      { index: 696, editName: 'gate_01', logicType: 83, walkBlockAreas: [[1, -2, 0, 5]] },
      {
        index: 700,
        editName: 'gate_01_open',
        logicType: 84,
        walkBlockAreas: [
          [1, -2, 0, 1],
          [1, 2, 0, 1],
        ],
      },
    ],
  });

  it('joins the player wall rows to their hitpoints, repair steps, gate pairs and wood', () => {
    // A post holds one and a half pools; a gate one per closed cell, its open state included.
    expect(scriptLandscapeTypes(wallIr(true)).map((t) => t.wall)).toEqual([
      { maxHitpoints: 150, repairPerStrike: 5, construction: [{ goodType: WOOD, amount: 1 }] },
      {
        maxHitpoints: 500,
        repairPerStrike: 5,
        construction: [{ goodType: WOOD, amount: 1 }],
        gate: { open: false, counterpartGfxIndex: 700 },
      },
      {
        maxHitpoints: 500,
        repairPerStrike: 5,
        construction: [{ goodType: WOOD, amount: 1 }],
        gate: { open: true, counterpartGfxIndex: 696 },
      },
    ]);
  });

  it('leaves wall rows no player may own as scenery', () => {
    expect(scriptLandscapeTypes(wallIr(false)).map((t) => t.wall)).toEqual([undefined, undefined, undefined]);
  });
});
