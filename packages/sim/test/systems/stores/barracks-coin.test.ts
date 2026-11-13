import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Owner, StorePriority } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { grassMap, siteAt, WOOD } from '../economy/production/producer-supply/support.js';
import { CARRIER, utilityContent } from '../economy/production/utility-content.js';

const PLAYER = 0;
const RIVAL = 1;
const COIN = 211;
const BARRACKS = 14;
const COIN_SHELF = 60;
const MAP_WIDTH = 16;

/** A barracks with porters and a coin shelf: `isBarracks` takes a training house that employs anybody. */
function barracksContent(): ContentSet {
  const base = utilityContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: COIN, id: 'coin', weight: 1 }],
    buildings: [
      ...base.buildings,
      {
        typeId: BARRACKS,
        id: 'barracks',
        kind: 'training',
        workers: [{ jobType: CARRIER, count: 1 }],
        stock: [{ goodType: COIN, capacity: COIN_SHELF, initial: 0 }],
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

describe('barracks coin priority', () => {
  it('marks the coin in a finished barracks until its owner unmarks the coin on one', () => {
    const sim = new Simulation({ seed: 1, content: barracksContent(), map: grassMap(MAP_WIDTH, 1) });
    const finish = (x: number, player = PLAYER): Entity => {
      const site = siteAt(sim, BARRACKS, x, 0);
      sim.world.add(site, Owner, { player });
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: site });
      sim.step();
      return site;
    };
    const first = finish(0);
    expect(sim.world.get(first, StorePriority).goods).toEqual([COIN]);
    sim.enqueueSetup({ kind: 'setStorePriority', building: first, goodType: COIN, priority: false });
    sim.step();
    expect(sim.world.has(finish(4), StorePriority)).toBe(false);
    expect(sim.world.get(finish(8, RIVAL), StorePriority).goods).toEqual([COIN]);
  });
});
