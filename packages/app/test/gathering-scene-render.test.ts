import { buildSpriteScene } from '@open-northland/render';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
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
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox.js';

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

describe('gathering scene — render classification after all six gathering cycles', () => {
  const sim = createSceneSim(sandboxScene);
  sim.run(sandboxScene.runTicks);
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
