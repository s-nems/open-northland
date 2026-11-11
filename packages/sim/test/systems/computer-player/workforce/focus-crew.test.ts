import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/ecs/world.js';
import type { WantedGood } from '../../../../src/systems/computer-player/workforce/collectors/index.js';
import {
  focusPriorityOrders,
  focusShortPosts,
  focusYieldPosts,
} from '../../../../src/systems/computer-player/workforce/focus-crew.js';
import {
  aiSim,
  CIVILIST,
  ctxOf,
  entityOfBuilding,
  HQ_Y,
  MILL_TYPE,
  MUD,
  placeHq,
  SEAT,
  STONE,
  VIKING,
  WOOD,
} from '../support.js';

function millSite() {
  const sim = aiSim();
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: MILL_TYPE,
    x: 4,
    y: HQ_Y + 8,
    tribe: VIKING,
    owner: SEAT,
    underConstruction: true,
  });
  sim.step();
  return { sim, mill: entityOfBuilding(sim, MILL_TYPE) };
}

describe('focusPriorityOrders', () => {
  it('marks the focus site once, and lifts the mark while the builders are to spread', () => {
    const { sim, mill } = millSite();
    const mark = focusPriorityOrders(sim.world, mill, false);
    expect(mark).toEqual([{ kind: 'setConstructionPriority', building: mill, prioritized: true }]);
    expect(focusPriorityOrders(sim.world, mill, true)).toEqual([]);

    for (const c of mark) sim.enqueueSetup(c);
    sim.step();
    expect(focusPriorityOrders(sim.world, mill, false)).toEqual([]);
    expect(focusPriorityOrders(sim.world, mill, true)).toEqual([
      { kind: 'setConstructionPriority', building: mill, prioritized: false },
    ]);
  });
});

/** One post row of each of `goods`, as the opening wants them. */
function rows(goods: readonly number[]): WantedGood[] {
  const content = ctxOf(aiSim()).content;
  return goods.map((typeId) => {
    const good = content.goods.find((g) => g.typeId === typeId);
    if (good === undefined) throw new Error(`fixture lacks good ${typeId}`);
    return { good, harvestAtomic: 0, job: CIVILIST, target: 1, min: 1, row: 1 };
  });
}

const postsOf = (wanted: readonly WantedGood[], good: number) => wanted.find((w) => w.good.typeId === good);

describe('focusShortPosts', () => {
  it('gives a good the focus site waits on one post over its row, filled ahead of the reserve', () => {
    const wanted = focusShortPosts(rows([WOOD, STONE]), new Set([STONE]));
    expect(postsOf(wanted, STONE)).toMatchObject({ target: 2, min: 2, row: 2 });
    expect(postsOf(wanted, WOOD)).toMatchObject({ target: 1, min: 1, row: 1 });
  });
});

describe('focusYieldPosts', () => {
  const holders = new Map<number, Entity[]>([
    [WOOD, [1 as Entity]],
    [STONE, [2 as Entity, 3 as Entity]],
    [MUD, [4 as Entity]],
  ]);

  it('cuts the good with the most holders first, then the earlier good', () => {
    const wanted = focusYieldPosts(rows([WOOD, STONE, MUD]), holders, new Set(), new Set(), 2);
    expect(postsOf(wanted, STONE)).toMatchObject({ target: 1, min: 1, row: 1 });
    expect(postsOf(wanted, WOOD)).toMatchObject({ target: 0, min: 0, row: 0 });
    expect(postsOf(wanted, MUD)).toMatchObject({ target: 1, min: 1, row: 1 });
  });

  it('keeps the posts of a good the focus waits on and of an apprentice', () => {
    const wanted = focusYieldPosts(
      rows([WOOD, STONE, MUD]),
      holders,
      new Set([STONE]),
      new Set([1 as Entity]),
      1,
    );
    expect(postsOf(wanted, STONE)?.target).toBe(1);
    expect(postsOf(wanted, WOOD)?.target).toBe(1);
    expect(postsOf(wanted, MUD)?.target).toBe(0);
  });
});
