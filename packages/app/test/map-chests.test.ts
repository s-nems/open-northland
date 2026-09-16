import { parseContentSet } from '@open-northland/data';
import { resolveResourceDraw } from '@open-northland/render';
import { components, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { mapChestSpawns, simResourceObjectNames } from '../src/content/map-resources.js';
import { buildChestBinding, resolveChestRefs } from '../src/content/resource-gfx/chest.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { harvestablePlacementOrdinals, spawnMapChests } from '../src/game/sandbox/map-spawn.js';

/**
 * The decoded-map → sim CHEST join: a map's placed `chest wooden` / `chest magical` objects become closed
 * `Chest` entities carrying the chest type the map's `levels` lane authors, out of the static collision bake
 * like the harvestables, and drawn by their own record when the map's static sprite is retired.
 */

const { Chest, ResourceFootprint } = components;

const WOODEN_CHEST_LOGIC_TYPE = 85;
const MAGICAL_CHEST_LOGIC_TYPE = 86;

function fixtureIr(): ContentIr {
  return {
    landscape: [
      { typeId: 1, id: 'void' },
      { typeId: WOODEN_CHEST_LOGIC_TYPE, id: 'chest_wooden' },
      { typeId: MAGICAL_CHEST_LOGIC_TYPE, id: 'chest_magical' },
    ],
    landscapeGfx: [
      { index: 100, editName: 'test tree', logicType: 4 },
      {
        index: 843,
        editName: 'chest magical',
        logicType: MAGICAL_CHEST_LOGIC_TYPE,
        bmd: 'data/engine2d/bin/bobs/ls_chest.bmd',
        paletteName: 'rock03',
        frames: [{ state: 1, bobIds: [0] }],
      },
      {
        index: 844,
        editName: 'chest magical open',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/ls_chest.bmd',
        paletteName: 'rock03',
        frames: [{ state: 1, bobIds: [1] }],
      },
      {
        index: 845,
        editName: 'chest wooden',
        logicType: WOODEN_CHEST_LOGIC_TYPE,
        bmd: 'data/engine2d/bin/bobs/ls_chest.bmd',
        paletteName: 'human_player10',
        frames: [{ state: 1, bobIds: [2] }],
      },
      {
        index: 846,
        editName: 'chest wooden open',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/ls_chest.bmd',
        paletteName: 'human_player10',
        frames: [{ state: 1, bobIds: [3] }],
      },
    ],
    gatheringPipeline: [{ goodType: 5, goodId: 'wood', harvest: { landscapeType: 4, gfxIndices: [100] } }],
  };
}

/** The sandbox catalog plus the fixture's chest rows, so the sim knows the records the map places. */
function fixtureContent() {
  const base = sandboxContent();
  const ir = fixtureIr();
  const chests = (ir.landscapeGfx ?? []).filter((g) => g.editName?.startsWith('chest') === true);
  return parseContentSet({
    ...base,
    landscape: [...base.landscape, ...(ir.landscape ?? [])],
    landscapeGfx: [...base.landscapeGfx, ...chests],
  });
}

/** Three placements: a tree, a wooden chest of type 20 and a magical chest of type 52. */
const OBJECTS = {
  types: ['test tree', 'chest wooden', 'chest magical'],
  placements: [4, 4, 0, 10, 6, 1, 20, 8, 2],
  levels: [3, 20, 52],
};

describe('mapChestSpawns', () => {
  it('reads every chest placement with its kind, record and authored contents, in placement order', () => {
    expect(mapChestSpawns(OBJECTS, fixtureIr())).toEqual([
      { kind: 'wooden', gfxIndex: 845, hx: 10, hy: 6, contents: 20, placement: 1 },
      { kind: 'magical', gfxIndex: 843, hx: 20, hy: 8, contents: 52, placement: 2 },
    ]);
  });

  it('a map without a levels lane authors empty chests', () => {
    const { levels: _levels, ...bare } = OBJECTS;
    expect(mapChestSpawns(bare, fixtureIr()).map((c) => c.contents)).toEqual([0, 0]);
  });

  it('keeps chest object names out of the static collision bake beside the harvestables', () => {
    const names = simResourceObjectNames(fixtureIr(), new Set(['wood']));
    expect([...names].sort()).toEqual(['chest magical', 'chest wooden', 'test tree']);
  });
});

describe('spawnMapChests', () => {
  it('spawns a footprinted Chest per placement and joins it back to its placement ordinal', () => {
    const sim = new Simulation({ seed: 1, content: fixtureContent() });
    const result = spawnMapChests(sim, OBJECTS, fixtureIr());
    expect(result.spawned).toBe(2);
    const chests = [...sim.world.query(Chest)];
    expect(chests).toHaveLength(2);
    expect(chests.map((e) => sim.world.get(e, Chest))).toEqual([
      { kind: 'wooden', contents: 20, gfxIndex: 845 },
      { kind: 'magical', contents: 52, gfxIndex: 843 },
    ]);
    for (const e of chests) expect(sim.world.has(e, ResourceFootprint)).toBe(true);
    expect([...result.placementByEntity.values()]).toEqual([1, 2]);
    // The tree resolves to the sandbox wood node, so its ordinal leads the two chests.
    expect(harvestablePlacementOrdinals(sim.content, OBJECTS, fixtureIr())).toEqual([0, 1, 2]);
  });
});

describe('the chest draw binding', () => {
  it('binds each record under its own index and falls back to the first loaded chest', () => {
    const refs = resolveChestRefs(fixtureIr());
    expect(refs.map((r) => r.gfxIndex)).toEqual([843, 844, 845, 846]);
    const loaded = new Set(['ls_chest.rock03', 'ls_chest.human_player10']);
    const binding = buildChestBinding(refs, loaded);
    expect(binding?.byGfxIndex?.[845]).toEqual([{ layer: 'ls_chest.human_player10', bob: 2 }]);
    expect(binding?.byGfxIndex?.[846]).toEqual([{ layer: 'ls_chest.human_player10', bob: 3 }]);
    if (binding === undefined) throw new Error('no chest binding');
    expect(
      resolveResourceDraw(binding, { kind: 'chest', ref: 1, x: 0, y: 0, depth: 0, gfxIndex: 846 }),
    ).toEqual({ layer: 'ls_chest.human_player10', bob: 3 });
    expect(binding?.default).toEqual({ layer: 'ls_chest.rock03', bob: 0 });
    expect(buildChestBinding(refs, new Set())).toBeUndefined();
  });
});
