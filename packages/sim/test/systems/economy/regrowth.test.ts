import { describe, expect, it } from 'vitest';
import {
  DeliveryFlag,
  Felling,
  Position,
  Regrowth,
  type RegrowthData,
  Resource,
  Signpost,
  TreeGrowth,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import { hexDistance, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { createResourceNode, regrowthSystem, scheduleTreeRegrowth } from '../../../src/systems/index.js';
import { harvestFromNode } from '../../../src/systems/settlers/atomics/effects/goods/harvest.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  CHOP_ATOMIC,
  MUSHROOM,
  MUSHROOM_GFX,
  mushroomAt,
  PICK_ATOMIC,
  TREE_GFX,
  TREE_MAX_LEVEL,
  treeAt,
  treeContent,
  WOOD,
} from '../../fixtures/trees.js';

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
/** A pick takes its unit on the stroke that lands. */
const PICK_STROKES = 1;
/** A mushroom holding this many picks, as a map variant's richer yield lays one. */
const PICKS = 2;
const TREE_REGROWTH = {
  kind: 'tree',
  goodType: WOOD,
  harvestAtomic: CHOP_ATOMIC,
  wood: TREE_MAX_LEVEL,
  gfxIndex: TREE_GFX,
} as const;
const MUSHROOM_REGROWTH = {
  kind: 'mushroom',
  goodType: MUSHROOM,
  harvestAtomic: PICK_ATOMIC,
  gfxIndex: MUSHROOM_GFX,
} as const;

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

type Regrown = typeof TREE_REGROWTH | typeof MUSHROOM_REGROWTH;

function regrowDue(sim: Simulation, count: number, regrown: Regrown = TREE_REGROWTH): void {
  for (let i = 0; i < count; i++) {
    sim.world.add(sim.world.create(), Regrowth, { dueAtTick: 0, ...FELLED, ...regrown });
  }
  regrowthSystem(sim.world, ctxOf(sim));
}

function trees(sim: Simulation): Entity[] {
  return [...sim.world.query(Felling, Resource)];
}

function pending(sim: Simulation): RegrowthData[] {
  return [...sim.world.query(Regrowth)].map((e) => sim.world.get(e, Regrowth));
}

describe('regrowth', () => {
  it('schedules a felled tree 5 to 20 minutes out, for its own record', () => {
    const sim = mapSim();
    const tree = treeAt(sim, FELLED.hx, FELLED.hy, 3);
    scheduleTreeRegrowth(sim.world, ctxOf(sim), tree);
    const [due] = pending(sim);
    expect(due).toMatchObject({ ...FELLED, ...TREE_REGROWTH });
    expect(due?.dueAtTick).toBeGreaterThanOrEqual(sim.tick + DELAY_MIN_TICKS);
    expect(due?.dueAtTick).toBeLessThan(sim.tick + DELAY_MAX_TICKS);
  });

  it('schedules nothing while the most regrowths the world holds are waiting', () => {
    const sim = mapSim();
    const tree = treeAt(sim, FELLED.hx, FELLED.hy, 3);
    for (let i = 0; i < MAX_PENDING; i++) {
      sim.world.add(sim.world.create(), Regrowth, {
        dueAtTick: DELAY_MIN_TICKS,
        ...FELLED,
        ...TREE_REGROWTH,
      });
    }
    scheduleTreeRegrowth(sim.world, ctxOf(sim), tree);
    expect([...sim.world.query(Regrowth)]).toHaveLength(MAX_PENDING);
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
    expect([...sim.world.query(Regrowth)]).toHaveLength(0);
  });

  it('schedules a regrowth of its own record for each unit picked off a mushroom', () => {
    const sim = mapSim();
    const mushroom = mushroomAt(sim, FELLED.hx, FELLED.hy);
    sim.world.mut(mushroom, Resource).remaining = PICKS;
    const picker = sim.world.create();
    for (let pick = 0; pick < PICKS; pick++) {
      expect(harvestFromNode(sim.world, ctxOf(sim), picker, mushroom, MUSHROOM, PICK_STROKES)).toBe(1);
    }
    expect(sim.world.isAlive(mushroom)).toBe(false);
    expect(pending(sim)).toEqual(
      Array.from({ length: PICKS }, () => expect.objectContaining({ ...FELLED, ...MUSHROOM_REGROWTH })),
    );
  });

  it('schedules nothing for a pick off a node of any other landscape', () => {
    const sim = mapSim();
    const node = createResourceNode(sim.world, sim.content, {
      good: WOOD,
      x: FELLED.hx,
      y: FELLED.hy,
      remaining: 1,
      harvestAtomic: CHOP_ATOMIC,
      gfxIndex: TREE_GFX,
    });
    if (node === null) throw new Error('tree record missing from the fixture content');
    expect(harvestFromNode(sim.world, ctxOf(sim), sim.world.create(), node, WOOD, PICK_STROKES)).toBe(1);
    expect(pending(sim)).toEqual([]);
  });

  it('sprouts mushrooms of the picked record in the forest, each holding one pick', () => {
    const sim = mapSim();
    plantForest(sim);
    const before = new Set(sim.world.query(Resource));
    regrowDue(sim, REGROWTHS, MUSHROOM_REGROWTH);
    const sprouted = [...sim.world.query(Resource)].filter((e) => !before.has(e));
    expect(sprouted.length).toBeGreaterThan(0);
    for (const mushroom of sprouted) {
      expect(sim.world.get(mushroom, Resource)).toMatchObject({
        goodType: MUSHROOM,
        remaining: 1,
        gfxIndex: MUSHROOM_GFX,
      });
      expect(sim.world.has(mushroom, Felling) || sim.world.has(mushroom, TreeGrowth)).toBe(false);
      const pos = sim.world.get(mushroom, Position);
      expect(hexDistance(nodeOfPosition(pos.x, pos.y), FELLED)).toBeLessThanOrEqual(SEARCH_STEPS);
    }
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
