import { describe, expect, it } from 'vitest';
import { Position, Stockpile } from '../../../src/components/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { ownedBuildings } from '../../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../../src/systems/computer-player/base.js';
import { homeStockOf } from '../../../src/systems/computer-player/home-stock.js';
import { seatStockOf } from '../../../src/systems/stores/index.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  foundColony,
  seatOverSea,
  seatWithTwoColonies,
  storeOnColony,
} from '../../fixtures/seat-over-sea.js';
import { SEAT, STONE, WOOD } from './support.js';

const COLONY_HEAP = { x: 118, y: 60 };
const HOME_WOOD = 7;
const COLONY_WOOD = 11;
const COLONY_STONE = 3;

describe('the home stock of a seat', () => {
  it('takes the colony store and the heaps it reaches out of the stock', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    const store = storeOnColony(sim);
    const home = seatBaseOf(sim.world, ctx, SEAT);
    if (home === null) throw new Error('setup: no base');
    sim.world.add(store, Stockpile, { amounts: new Map([[WOOD, COLONY_WOOD]]) });
    if (sim.world.has(home, Stockpile)) sim.world.remove(home, Stockpile);
    sim.world.add(home, Stockpile, { amounts: new Map([[WOOD, HOME_WOOD]]) });
    const heap = sim.world.create();
    sim.world.add(heap, Position, positionOfNode(COLONY_HEAP.x, COLONY_HEAP.y));
    sim.world.add(heap, Stockpile, { amounts: new Map([[STONE, COLONY_STONE]]) });
    const whole = seatStockOf(sim.world, SEAT);
    expect(whole.units(WOOD)).toBeGreaterThanOrEqual(HOME_WOOD + COLONY_WOOD);
    foundColony(sim);
    const stock = homeStockOf(sim.world, { ...ctx, tick: sim.tick }, SEAT);
    expect(stock.units(WOOD)).toBe(whole.units(WOOD) - COLONY_WOOD);
    expect(stock.units(STONE)).toBe(whole.units(STONE) - COLONY_STONE);
    expect(stock.exceeds(WOOD, HOME_WOOD)).toBe(false);
  });

  it('takes every colony out of the stock', () => {
    const { sim } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const away = ownedBuildings(sim.world, SEAT).filter((e) => e !== seatBaseOf(sim.world, ctx, SEAT));
    for (const store of away) sim.world.add(store, Stockpile, { amounts: new Map([[WOOD, COLONY_WOOD]]) });
    const stock = homeStockOf(sim.world, { ...ctx, tick: sim.tick }, SEAT);
    expect(stock.units(WOOD)).toBe(seatStockOf(sim.world, SEAT).units(WOOD) - away.length * COLONY_WOOD);
  });
});
