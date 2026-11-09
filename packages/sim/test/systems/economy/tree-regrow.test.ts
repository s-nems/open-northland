import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Felling,
  Position,
  Resource,
  Signpost,
  TreeGrowth,
  TreeRegrow,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import { hexDistance, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { scheduleTreeRegrow, treeRegrowSystem } from '../../../src/systems/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { CHOP_ATOMIC, TREE_GFX, TREE_MAX_LEVEL, treeAt, treeContent, WOOD } from '../../fixtures/trees.js';

const MAP_NODES = 40;
const FELLED = { hx: 20, hy: 20 } as const;
const DELAY_MIN_TICKS = 3600;
const DELAY_MAX_TICKS = DELAY_MIN_TICKS + 10800;
/** The search's reach from the felled tree, in lattice steps. */
const SEARCH_STEPS = 11;
/** Enough regrowths that the one-in-ten failure cannot leave them all empty. */
const REGROWTHS = 20;
const MAX_PENDING = 300;
/** Signposts stand on every node of a square this far around the felled tree. */
const SIGNPOST_REACH = 6;

function mapSim(): Simulation {
  return new Simulation({ seed: 7, content: treeContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
}

/** Saplings on every other node of a square around the felled tree: a forest that blocks nothing. */
function plantForest(sim: Simulation): void {
  for (let hy = FELLED.hy - 4; hy <= FELLED.hy + 4; hy += 2) {
    for (let hx = FELLED.hx - 4; hx <= FELLED.hx + 4; hx += 2) {
      if (hx !== FELLED.hx || hy !== FELLED.hy) treeAt(sim, hx, hy, 1);
    }
  }
}

function regrowDue(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) {
    sim.world.add(sim.world.create(), TreeRegrow, {
      dueAtTick: 0,
      ...FELLED,
      goodType: WOOD,
      harvestAtomic: CHOP_ATOMIC,
      wood: TREE_MAX_LEVEL,
      gfxIndex: TREE_GFX,
    });
  }
  treeRegrowSystem(sim.world, ctxOf(sim));
}

function trees(sim: Simulation): Entity[] {
  return [...sim.world.query(Felling, Resource)];
}

describe('tree regrowth', () => {
  it('schedules a felled tree 5 to 20 minutes out, for its own record', () => {
    const sim = mapSim();
    const tree = treeAt(sim, FELLED.hx, FELLED.hy, 3);
    scheduleTreeRegrow(sim.world, ctxOf(sim), tree);
    const [pending] = [...sim.world.query(TreeRegrow)].map((e) => sim.world.get(e, TreeRegrow));
    expect(pending).toMatchObject({ ...FELLED, goodType: WOOD, gfxIndex: TREE_GFX });
    expect(pending?.dueAtTick).toBeGreaterThanOrEqual(sim.tick + DELAY_MIN_TICKS);
    expect(pending?.dueAtTick).toBeLessThan(sim.tick + DELAY_MAX_TICKS);
  });

  it('schedules nothing while the most regrowths the world holds are waiting', () => {
    const sim = mapSim();
    const tree = treeAt(sim, FELLED.hx, FELLED.hy, 3);
    for (let i = 0; i < MAX_PENDING; i++) {
      sim.world.add(sim.world.create(), TreeRegrow, {
        dueAtTick: DELAY_MIN_TICKS,
        ...FELLED,
        goodType: WOOD,
        harvestAtomic: CHOP_ATOMIC,
        wood: TREE_MAX_LEVEL,
      });
    }
    scheduleTreeRegrow(sim.world, ctxOf(sim), tree);
    expect([...sim.world.query(TreeRegrow)]).toHaveLength(MAX_PENDING);
  });

  it('seeds saplings in the forest around the felled tree, each on a free node in reach', () => {
    const sim = mapSim();
    plantForest(sim);
    const before = new Set(trees(sim));
    regrowDue(sim, REGROWTHS);
    const saplings = trees(sim).filter((e) => !before.has(e));
    expect(saplings.length).toBeGreaterThan(0);
    const nodes = new Set<string>();
    for (const sapling of saplings) {
      expect(sim.world.get(sapling, TreeGrowth).level).toBe(1);
      expect(sim.world.get(sapling, Resource)).toMatchObject({ remaining: 0, gfxIndex: TREE_GFX });
      const pos = sim.world.get(sapling, Position);
      const at = nodeOfPosition(pos.x, pos.y);
      expect(hexDistance(at, FELLED)).toBeLessThanOrEqual(SEARCH_STEPS);
      nodes.add(`${at.hx},${at.hy}`);
    }
    expect(nodes.size).toBe(saplings.length);
    expect([...sim.world.query(TreeRegrow)]).toHaveLength(0);
  });

  it.each([
    ['signpost', (sim: Simulation, post: Entity) => sim.world.add(post, Signpost, { links: [] })],
    ['work flag', (sim: Simulation, flag: Entity) => sim.world.add(flag, DeliveryFlag, {})],
  ])('seeds no sapling on a %s', (_marker, mark) => {
    const sim = mapSim();
    plantForest(sim);
    const before = new Set(trees(sim));
    const posts = new Set<string>();
    for (let hy = FELLED.hy - SIGNPOST_REACH; hy <= FELLED.hy + SIGNPOST_REACH; hy++) {
      for (let hx = FELLED.hx - SIGNPOST_REACH; hx <= FELLED.hx + SIGNPOST_REACH; hx++) {
        const post = sim.world.create();
        sim.world.add(post, Position, positionOfNode(hx, hy));
        mark(sim, post);
        posts.add(`${hx},${hy}`);
      }
    }
    regrowDue(sim, REGROWTHS);
    for (const sapling of trees(sim).filter((e) => !before.has(e))) {
      const pos = sim.world.get(sapling, Position);
      const at = nodeOfPosition(pos.x, pos.y);
      expect(posts.has(`${at.hx},${at.hy}`)).toBe(false);
    }
  });

  it('seeds nothing beside a lone tree, outside any forest', () => {
    const sim = mapSim();
    treeAt(sim, FELLED.hx + 2, FELLED.hy, 1);
    regrowDue(sim, REGROWTHS);
    expect(trees(sim)).toHaveLength(1);
  });
});
