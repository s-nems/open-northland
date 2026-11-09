import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Position,
  Resource,
  ResourceFootprint,
  TreeGrowth,
} from '../../../src/components/index.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import { treeGrowthSystem } from '../../../src/systems/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { DEAD_TREE_GFX, TREE_GFX, TREE_MAX_LEVEL, treeAt, treeContent } from '../../fixtures/trees.js';

const MAP_NODES = 40;
/** Node (10, 10) of the 40-node map lies in growth section column 5, row 5: run 105, at tick 105 x 24. */
const TREE_NODE = 10;
const SECTION_RUN_TICK = 105 * 24;
const GROWTH_PERIOD_TICKS = 9600;

function growAt(sim: Simulation, tick: number): void {
  treeGrowthSystem(sim.world, { ...ctxOf(sim), tick });
}

describe('tree growth', () => {
  it('grows a sapling one valency per run of its map section, to a fellable full-grown tree', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const tree = treeAt(sim, TREE_NODE, TREE_NODE, 1);
    expect(sim.world.get(tree, Resource).remaining).toBe(0);

    growAt(sim, SECTION_RUN_TICK - 24);
    expect(sim.world.get(tree, TreeGrowth).level).toBe(1);
    growAt(sim, SECTION_RUN_TICK);
    expect(sim.world.get(tree, TreeGrowth).level).toBe(2);
    expect(sim.world.get(tree, Resource).remaining).toBe(0);
    expect(sim.snapshot().events).toContainEqual(expect.objectContaining({ kind: 'treeGrew', node: tree }));

    growAt(sim, SECTION_RUN_TICK + GROWTH_PERIOD_TICKS);
    expect(sim.world.has(tree, TreeGrowth)).toBe(false);
    expect(sim.world.get(tree, Resource).remaining).toBe(TREE_MAX_LEVEL);
    expect(sim.world.get(tree, ResourceFootprint)).toEqual({ gfx: TREE_GFX, level: TREE_MAX_LEVEL });
  });

  it('keeps a full-grown yield above the valency, as a map variant scales it, until the tree is fellable', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const wood = 2 * TREE_MAX_LEVEL;
    const tree = treeAt(sim, TREE_NODE, TREE_NODE, 2, { wood });
    expect(sim.world.get(tree, Resource).remaining).toBe(0);
    growAt(sim, SECTION_RUN_TICK);
    expect(sim.world.get(tree, Resource).remaining).toBe(wood);
  });

  it('moves a settler off the node a growing trunk closes', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const tree = treeAt(sim, TREE_NODE, TREE_NODE, 2);
    const settler = settlerAt(sim, { jobType: null, position: positionOfNode(TREE_NODE, TREE_NODE) });
    growAt(sim, SECTION_RUN_TICK);
    expect(sim.world.has(tree, TreeGrowth)).toBe(false);
    const pos = sim.world.get(settler, Position);
    expect(nodeOfPosition(pos.x, pos.y)).not.toEqual({ hx: TREE_NODE, hy: TREE_NODE });
  });

  it('moves a work flag off the node a growing trunk closes', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    treeAt(sim, TREE_NODE, TREE_NODE, 2);
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(TREE_NODE, TREE_NODE));
    sim.world.add(flag, DeliveryFlag, {});
    growAt(sim, SECTION_RUN_TICK);
    const pos = sim.world.get(flag, Position);
    expect(nodeOfPosition(pos.x, pos.y)).not.toEqual({ hx: TREE_NODE, hy: TREE_NODE });
  });

  it('holds no wood and never grows on a record whose valency stops below fellable', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const tree = treeAt(sim, TREE_NODE, TREE_NODE, 1, { gfxIndex: DEAD_TREE_GFX });
    expect(sim.world.has(tree, TreeGrowth)).toBe(false);
    expect(sim.world.get(tree, Resource).remaining).toBe(0);
  });

  it('starts a map tree authored full-grown without growth', () => {
    const sim = new Simulation({ seed: 1, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const tree = treeAt(sim, TREE_NODE, TREE_NODE, TREE_MAX_LEVEL);
    expect(sim.world.has(tree, TreeGrowth)).toBe(false);
    expect(sim.world.get(tree, Resource).remaining).toBe(TREE_MAX_LEVEL);
  });
});
