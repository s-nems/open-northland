import { describe, expect, it } from 'vitest';
import { Building, Position } from '../../src/components/index.js';
import { ONE, positionOfNode } from '../../src/index.js';
import { buildingBlockedLayer } from '../../src/systems/footprint/building-blocked-cache.js';
import { resourceBlockedLayer } from '../../src/systems/footprint/resource-blocked-cache.js';
import { dynamicBlockOverlay, unstampResourceFootprint } from '../../src/systems/index.js';
import { TEST_HUT, VIKING, WOOD, WOOD_ATOMIC } from './resource-footprint/content.js';
import { ctxOf, mappedSim, placeResource, terrainOf } from './resource-footprint/support.js';

/** The hut's anchor, its one blocked cell, with the door one row below. */
const HUT_AT = { x: 6, y: 2 };
const TREE_AT = { x: 3, y: 1 };

/** The dynamic walk-block overlay reads the three layers' per-node counts, so it must track every
 *  stamp its layers take, and `verifyCaches` must catch a count that drifts from its layer's cells. */
describe('the dynamic walk-block overlay', () => {
  it('follows a placement, a felled resource and a demolition', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const hutNode = terrain.nodeAt(HUT_AT.x, HUT_AT.y);
    const doorNode = terrain.nodeAt(HUT_AT.x, HUT_AT.y + 1);
    const treeNode = terrain.nodeAt(TREE_AT.x, TREE_AT.y);
    const blocked = () => dynamicBlockOverlay(sim.world, ctx, terrain);
    expect(blocked().size).toBe(0);

    const tree = placeResource(sim, WOOD, WOOD_ATOMIC, TREE_AT.x, TREE_AT.y);
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(HUT_AT.x, HUT_AT.y));
    sim.world.add(hut, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
    expect([blocked().has(treeNode), blocked().has(hutNode), blocked().has(doorNode)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(sim.world.verifyCaches()).toEqual([]);
    const counts = buildingBlockedLayer(sim.world, ctx, terrain).counts;

    unstampResourceFootprint(sim.world, tree);
    sim.world.destroy(tree);
    expect(blocked().has(treeNode)).toBe(false);
    sim.world.destroy(hut);
    expect(blocked().has(hutNode)).toBe(false);
    expect(blocked().size).toBe(0);
    // The rebuild restamped the same array rather than allocating a map-sized one.
    expect(buildingBlockedLayer(sim.world, ctx, terrain).counts).toBe(counts);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('has its layer counts checked against their cells', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    placeResource(sim, WOOD, WOOD_ATOMIC, TREE_AT.x, TREE_AT.y);
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(HUT_AT.x, HUT_AT.y));
    sim.world.add(hut, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
    const resources = resourceBlockedLayer(sim.world, terrain).counts;
    const buildings = buildingBlockedLayer(sim.world, ctx, terrain).counts;
    const stray = terrain.nodeAt(0, 0);

    resources[stray] = 1;
    buildings[stray] = 1;
    expect(sim.world.verifyCaches()).toEqual([
      'resourceBlockedCells counts disagree with its cells - a node count missed a stamp',
      'buildingBlockedCells counts disagree with its cells - a rebuild missed a restamp',
    ]);
  });
});
