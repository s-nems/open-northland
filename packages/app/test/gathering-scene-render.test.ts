import { buildSpriteScene } from '@open-northland/render';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  STONE_DEPOSIT_UNITS,
} from '../src/catalog/mining.js';
import {
  GATHERERS,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_STONE,
  GOOD_WOOD,
  placeFlag,
  placeResourceNode,
  spawnBoundGatherer,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import type { SceneDefinition } from '../src/scenes/types.js';

const GOODS = {
  wood: GOOD_WOOD,
  stone: GOOD_STONE,
  mud: GOOD_MUD,
  iron: GOOD_IRON,
  gold: GOOD_GOLD,
  mushroom: GOOD_MUSHROOM,
} as const;
const WOOD_TREES = GATHERERS.find((gatherer) => gatherer.good === GOOD_WOOD)?.nodes ?? 0;
const MUSHROOM_NODES = GATHERERS.find((gatherer) => gatherer.good === GOOD_MUSHROOM)?.nodes ?? 0;

/** One gathering lane per good — worker, nodes, and its own drop-off flag on one row. The purpose-built
 *  full-consumption fixture (the sandbox scene keeps its camps busy indefinitely, so it cannot witness
 *  end states like "every node consumed"). */
const LANE_Y0 = 4;
const LANE_STEP = 2;
const WORKER_X = 8;
const NODE_X = 13;
const FLAG_X = 18;
/** Enough for the slowest lane to fully drain — clay (10 units × 6 strikes × 23-tick digs + rests)
 *  empties around tick 5400 on this layout; 6000 leaves honest headroom. */
const RUN_TICKS = 6000;

const fixture: SceneDefinition = {
  id: 'gathering-render-fixture',
  seed: 41,
  terrain: grassTerrain(30, 20),
  runTicks: RUN_TICKS,
  checks: [],
  build: (sim) => {
    GATHERERS.forEach((g, i) => {
      const y = LANE_Y0 + i * LANE_STEP;
      const flag = placeFlag(sim, FLAG_X, y);
      for (let n = 0; n < g.nodes; n++) placeResourceNode(sim, g, NODE_X + n, y);
      // The good filter pins each lane's gatherer to its own trade (neighbouring lanes overlap radii).
      spawnBoundGatherer(sim, g.job, WORKER_X, y, flag, { goodType: g.good });
    });
  },
};

describe('gathering render classification after all six gathering cycles', () => {
  const sim = createSceneSim(fixture);
  sim.run(fixture.runTicks);
  const draws = buildSpriteScene(sim.snapshot());

  it('every source node is consumed by the end', () => {
    expect(draws.filter((draw) => draw.kind === 'resource')).toHaveLength(0);
  });

  it('every felled tree leaves a stump draw carrying wood', () => {
    const stumps = draws.filter((draw) => draw.kind === 'stump');
    expect(stumps).toHaveLength(WOOD_TREES);
    expect(stumps.every((stump) => stump.goodType === GOODS.wood)).toBe(true);
  });

  it('each good piles onto capped ground heaps summing to the whole yield', () => {
    const heaps = draws.filter((draw) => draw.kind === 'stockpile' && draw.goodType !== undefined);
    const banked = new Map<number, number>();
    for (const heap of heaps) {
      expect(heap.fill ?? 0).toBeLessThanOrEqual(systems.MAX_GROUND_STACK);
      banked.set(heap.goodType as number, (banked.get(heap.goodType as number) ?? 0) + (heap.fill ?? 0));
    }
    expect(banked.get(GOODS.wood)).toBe(WOOD_TREES * WOOD_YIELD_PER_NODE);
    expect(banked.get(GOODS.stone)).toBe(STONE_DEPOSIT_UNITS);
    expect(banked.get(GOODS.mud)).toBe(CLAY_DEPOSIT_UNITS);
    expect(banked.get(GOODS.iron)).toBe(IRON_DEPOSIT_UNITS);
    expect(banked.get(GOODS.gold)).toBe(GOLD_DEPOSIT_UNITS);
    expect(banked.get(GOODS.mushroom)).toBe(MUSHROOM_NODES);
  });
});
