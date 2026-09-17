import { components, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { groundGoodByObjectName, mapGroundGoodsSpawns } from '../src/content/map-resources.js';
import { scriptLandscapeTypes } from '../src/content/script-landscape.js';
import { GOOD_SHOES, GOOD_SWORD_SHORT, sandboxContent } from '../src/game/sandbox/index.js';
import { harvestablePlacementOrdinals, spawnMapGroundGoods } from '../src/game/sandbox/map-spawn.js';

/**
 * The decoded-map → sim GROUND GOODS join: a map's placed goods objects (the landscape form of a good,
 * `goodtypes.ini` `landscapetype`) become loose heaps holding the `levels` lane's unit count, drawn and
 * clicked like any dropped good. A good naming the void type (livestock, vehicles, the chest) never lies
 * on the ground, so its records stay decor.
 */

const { LandscapeResource, Position, Stockpile } = components;

const VOID_LOGIC_TYPE = 1;
const SHOES_LOGIC_TYPE = 56;
const SWORD_LOGIC_TYPE = 65;
const TREE_LOGIC_TYPE = 4;

function fixtureIr(): ContentIr {
  return {
    goods: [
      { typeId: 30, id: 'shoes', landscapeType: SHOES_LOGIC_TYPE },
      { typeId: 41, id: 'sword_shord', landscapeType: SWORD_LOGIC_TYPE },
      { typeId: 64, id: 'chest', landscapeType: VOID_LOGIC_TYPE },
      { typeId: 99, id: 'unobtainium', landscapeType: 99 },
    ],
    landscape: [
      { typeId: VOID_LOGIC_TYPE, id: 'void', allowedOnEverything: true },
      { typeId: TREE_LOGIC_TYPE, id: 'tree' },
      { typeId: SHOES_LOGIC_TYPE, id: 'shoes' },
      { typeId: SWORD_LOGIC_TYPE, id: 'sword_short' },
      { typeId: 99, id: 'unobtainium' },
    ],
    landscapeGfx: [
      { index: 100, editName: 'test tree', logicType: TREE_LOGIC_TYPE },
      { index: 0, editName: 'player01 sign 01', logicType: VOID_LOGIC_TYPE },
      { index: 203, editName: 'shoes pile 01', logicType: SHOES_LOGIC_TYPE },
      { index: 211, editName: 'sword_short pile 01', logicType: SWORD_LOGIC_TYPE },
      { index: 300, editName: 'unobtainium pile 01', logicType: 99 },
    ],
    gatheringPipeline: [
      { goodType: 5, goodId: 'wood', harvest: { landscapeType: TREE_LOGIC_TYPE, gfxIndices: [100] } },
    ],
  };
}

/** Five placements: a tree, a sign, three shoes, one sword and a good the world's content lacks. */
const OBJECTS = {
  types: ['test tree', 'player01 sign 01', 'shoes pile 01', 'sword_short pile 01', 'unobtainium pile 01'],
  placements: [4, 4, 0, 6, 4, 1, 10, 6, 2, 20, 8, 3, 22, 8, 4],
  levels: [3, 1, 3, 1, 2],
};

describe('groundGoodByObjectName', () => {
  it('names the good each goods object lays down and leaves void-type decor alone', () => {
    expect([...groundGoodByObjectName(fixtureIr())]).toEqual([
      ['shoes pile 01', 'shoes'],
      ['sword_short pile 01', 'sword_shord'],
      ['unobtainium pile 01', 'unobtainium'],
    ]);
  });
});

describe('mapGroundGoodsSpawns', () => {
  it('reads every goods placement with its unit count, in placement order', () => {
    expect(mapGroundGoodsSpawns(OBJECTS, fixtureIr())).toEqual([
      { goodId: 'shoes', hx: 10, hy: 6, amount: 3, placement: 2 },
      { goodId: 'sword_shord', hx: 20, hy: 8, amount: 1, placement: 3 },
      { goodId: 'unobtainium', hx: 22, hy: 8, amount: 2, placement: 4 },
    ]);
  });

  it('a map without a levels lane lays single units', () => {
    const { levels: _levels, ...bare } = OBJECTS;
    expect(mapGroundGoodsSpawns(bare, fixtureIr()).map((g) => g.amount)).toEqual([1, 1, 1]);
  });
});

describe('spawnMapGroundGoods', () => {
  it('lays a heap per placement the content knows and joins it back to its placement ordinal', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const result = spawnMapGroundGoods(sim, OBJECTS, fixtureIr());
    expect(result.spawned).toBe(2);
    const heaps = [...sim.world.query(Stockpile, Position)];
    expect(heaps.map((e) => [...sim.world.get(e, Stockpile).amounts])).toEqual([
      [[GOOD_SHOES, 3]],
      [[GOOD_SWORD_SHORT, 1]],
    ]);
    // A mapless sim has no landscape placements for the heap to stand in for.
    for (const e of heaps) expect(sim.world.has(e, LandscapeResource)).toBe(false);
    expect([...result.placementByEntity.values()]).toEqual([2, 3]);
    // The tree resolves to the sandbox wood node, so its ordinal leads the two heaps; the unknown good
    // stays decor and keeps its static sprite.
    expect(harvestablePlacementOrdinals(sim.content, OBJECTS, fixtureIr())).toEqual([0, 2, 3]);
  });
});

describe('scriptLandscapeTypes', () => {
  it('marks a goods record by its good slug, so a scripted placement lays the heap', () => {
    const types = scriptLandscapeTypes(fixtureIr());
    expect(types.find((type) => type.typeId === 203)?.good).toEqual({ goodId: 'shoes' });
    expect(types.find((type) => type.typeId === 0)?.good).toBeUndefined();
  });
});
