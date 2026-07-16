import { components, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HARD_MINE_STRIKES_PER_UNIT } from '../src/catalog/mining.js';
import type { ContentIr } from '../src/content/ir.js';
import { harvestGoodByObjectName, mapResourceSpawns } from '../src/content/map-resources.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import { spawnMapResources } from '../src/game/sandbox/map-spawn.js';

/**
 * The decoded-map → sim RESOURCE join (plan `gathering-economy.md` step 6): a map's placed trees/ore/stone
 * become real harvestable `Resource` sim nodes instead of render-only decor, so a gatherer can work them.
 * The risky part is the DATA-DRIVEN join off the IR gathering pipeline (object EditName → good), proven
 * here on a synthetic IR; the end-to-end test then spawns over the real sandbox content and checks the exact
 * component set (Resource + Felling for wood, Resource + MineDeposit for stone) a gatherer needs.
 */

const { Resource, Felling, MineDeposit } = components;

/** A tiny synthetic IR: three harvestable object names (wood/stone via a gatherer trade, wheat with none)
 *  plus a decor object in no harvest stage. `index` values are arbitrary but internally consistent with the
 *  pipeline's `gfxIndices`, exactly as the real `ir.json` relates the two lanes. */
function fixtureIr(): ContentIr {
  return {
    landscapeGfx: [
      { index: 100, editName: 'test tree', logicType: 4 },
      { index: 101, editName: 'test tree tall', logicType: 4 },
      { index: 200, editName: 'test rock', logicType: 15 },
      { index: 300, editName: 'test grass', logicType: 2 }, // decor: in no harvest stage
      { index: 400, editName: 'test wheat', logicType: 27 },
    ],
    gatheringPipeline: [
      { goodType: 5, goodId: 'wood', harvest: { landscapeType: 4, gfxIndices: [100, 101] } },
      { goodType: 3, goodId: 'stone', harvest: { landscapeType: 15, gfxIndices: [200] } },
      // Maps a placed object to a good the app has NO gatherer trade for — must stay decor, never spawn.
      { goodType: 4, goodId: 'wheat', harvest: { landscapeType: 27, gfxIndices: [400] } },
    ],
  };
}

const GATHERABLE = new Set(['wood', 'stone', 'mud', 'iron', 'gold', 'mushroom']);

describe('harvestGoodByObjectName — the IR reverse lookup (object name → good)', () => {
  it('maps every harvest-stage object variant to its good + OWN gfx record, and leaves decor unmapped', () => {
    const m = harvestGoodByObjectName(fixtureIr());
    expect(m.get('test tree')).toEqual({ goodId: 'wood', gfxIndex: 100 });
    // A second variant of the same good keeps its OWN record index — the species-variety channel.
    expect(m.get('test tree tall')).toEqual({ goodId: 'wood', gfxIndex: 101 });
    expect(m.get('test rock')).toEqual({ goodId: 'stone', gfxIndex: 200 });
    // Mapped even though the app has no wheat gatherer.
    expect(m.get('test wheat')).toEqual({ goodId: 'wheat', gfxIndex: 400 });
    expect(m.has('test grass')).toBe(false); // decor in no harvest stage
  });

  it('degrades to an empty map when the IR lacks the gathering lanes', () => {
    expect(harvestGoodByObjectName({}).size).toBe(0);
  });
});

describe('mapResourceSpawns — the harvestable placements to spawn', () => {
  const objects = {
    types: ['test tree', 'test rock', 'test grass', 'test wheat'],
    // tree@(2,2), rock@(4,4), grass@(6,6) decor, wheat@(8,8) no-trade, tree@(10,10)
    placements: [2, 2, 0, 4, 4, 1, 6, 6, 2, 8, 8, 3, 10, 10, 0],
  };

  it('keeps only objects whose good has a real gatherer trade, at their half-cell anchors, in order', () => {
    const spawns = mapResourceSpawns(objects, fixtureIr(), GATHERABLE);
    // `placement` is the triplet ordinal in `placements` — the static→dynamic handover join key.
    expect(spawns).toEqual([
      { goodId: 'wood', gfxIndex: 100, hx: 2, hy: 2, placement: 0 },
      { goodId: 'stone', gfxIndex: 200, hx: 4, hy: 4, placement: 1 },
      { goodId: 'wood', gfxIndex: 100, hx: 10, hy: 10, placement: 4 },
    ]);
    // grass (decor) and wheat (no gatherer trade) are left as static decor.
  });
});

describe('spawnMapResources — end-to-end over real sandbox content', () => {
  it('spawns the map objects as the exact Resource component set a gatherer works', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const objects = {
      types: ['sandbox tree', 'sandbox rock', 'sandbox decor'],
      placements: [2, 2, 0, 4, 4, 1, 6, 6, 2, 8, 8, 0],
    };
    const ir: ContentIr = {
      landscapeGfx: [
        { index: 10, editName: 'sandbox tree', logicType: 4 },
        { index: 20, editName: 'sandbox rock', logicType: 15 },
        { index: 30, editName: 'sandbox decor', logicType: 2 },
      ],
      gatheringPipeline: [
        { goodType: 5, goodId: 'wood', harvest: { landscapeType: 4, gfxIndices: [10] } },
        { goodType: 3, goodId: 'stone', harvest: { landscapeType: 15, gfxIndices: [20] } },
      ],
    };

    const { spawned, placementByEntity } = spawnMapResources(sim, objects, ir);

    // Two trees + one rock spawned; the decor object made no node.
    expect(spawned).toBe(3);
    const resources = [...sim.world.query(Resource)];
    expect(resources).toHaveLength(3);
    const felled = resources.filter((e) => sim.world.has(e, Felling));
    const mined = resources.filter((e) => sim.world.has(e, MineDeposit));
    expect(felled).toHaveLength(2); // the two trees chop down
    expect(mined).toHaveLength(1); // the rock is a finite deposit
    expect(sim.world.get(mined[0] as number, MineDeposit).strikesPerUnit).toBe(HARD_MINE_STRIKES_PER_UNIT);
    // Every map-spawned node carries its placement's OWN gfx record as the render-variant tag (the
    // IR/app numbering — deliberately unrelated to the sim content's footprint records).
    expect(resources.map((e) => sim.world.get(e, Resource).gfxIndex).sort()).toEqual([10, 10, 20]);
    // The handover join: each spawned ENTITY maps to its placement ordinal (tree@0, rock@1, tree@3 —
    // the decor placement @2 spawned nothing), so the map entry can pair it with the static sprite.
    expect([...placementByEntity.values()].sort()).toEqual([0, 1, 3]);
    expect(new Set(placementByEntity.keys())).toEqual(new Set(resources));
  });
});
