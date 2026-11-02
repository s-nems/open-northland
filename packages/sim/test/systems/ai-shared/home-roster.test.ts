import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  type ComputerColonyState,
  Position,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { homeBuildings, homeSettlers } from '../../../src/systems/ai-shared/home-roster.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../../src/systems/computer-player/base.js';
import { homeStockOf } from '../../../src/systems/computer-player/colony/stock.js';
import { seatStockOf } from '../../../src/systems/stores/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  CIVILIST,
  HQ_TYPE,
  makeAiSeat,
  SEAT,
  SPEARMAN,
  STOCK_TYPE,
  STONE,
  VIKING,
  WOOD,
} from '../computer-player/support.js';

const MAP_CELLS = { width: 70, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const HOME_HQ = { x: 16, y: 20 };
const COLONY_STORE = { x: 110, y: 60 };
const COLONY_HEAP = { x: 118, y: 60 };
const COLONIST_AT = { x: 104, y: 70 };
const SOLDIER_AT = { x: 104, y: 74 };
const HOME_WOOD = 7;
const COLONY_WOOD = 11;
const COLONY_STONE = 3;

function islandMap() {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * width + col] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

/** A seat with a headquarters at home and a store, a civilian and a soldier on the east island. */
function seatOverSea(): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: islandMap() });
  makeAiSeat(sim, SEAT);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  const seatOwned = { tribe: VIKING, owner: SEAT };
  const built = { force: true, underConstruction: false, ...seatOwned };
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HOME_HQ, ...built });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: STOCK_TYPE, ...COLONY_STORE, ...built });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, ...COLONIST_AT, ...seatOwned });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: SPEARMAN, ...SOLDIER_AT, ...seatOwned });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, ...HOME_HQ, ...seatOwned });
  sim.step();
  return sim;
}

function foundColony(sim: Simulation): void {
  const carrier = aiControlEntity(sim.world, SEAT);
  const terrain = sim.terrain;
  if (carrier === null || terrain === undefined) throw new Error('setup: no carrier or terrain');
  const state: ComputerColonyState = {
    phase: 'running',
    since: 0,
    land: terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y)),
    site: { hx: COLONY_STORE.x, hy: COLONY_STORE.y },
    shore: null,
    berth: null,
    scout: null,
    ship: null,
    people: [],
    rest: [],
    failures: 0,
    rejected: [],
    retryAt: 0,
    builds: [],
    line: null,
    overflow: [],
  };
  sim.world.add(carrier, ComputerColony, state);
}

function storeOnColony(sim: Simulation): Entity {
  const store = ownedBuildings(sim.world, SEAT).find((e) => e !== seatBaseOf(sim.world, ctxOf(sim), SEAT));
  if (store === undefined) throw new Error('setup: no colony store');
  return store;
}

describe('the home view of a seat', () => {
  it('hands back the shared rosters and stock object while it holds no colony', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    expect(homeBuildings(sim.world, ctx, SEAT)).toBe(ownedBuildings(sim.world, SEAT));
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(ownedSettlers(sim.world, SEAT));
    expect(homeStockOf(sim.world, ctx, SEAT)).toBe(seatStockOf(sim.world, SEAT));
  });

  it('leaves the colony land out, but not a fighter standing there', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    const store = storeOnColony(sim);
    foundColony(sim);
    expect(homeBuildings(sim.world, ctx, SEAT)).toEqual(
      ownedBuildings(sim.world, SEAT).filter((e) => e !== store),
    );
    const settlers = ownedSettlers(sim.world, SEAT);
    expect(settlers).toHaveLength(3);
    expect(homeSettlers(sim.world, ctx, SEAT)).toHaveLength(2);
  });

  it('never elects a colony store as the seat base', () => {
    const sim = seatOverSea();
    const ctx = ctxOf(sim);
    const hq = seatBaseOf(sim.world, ctx, SEAT);
    if (hq === null) throw new Error('setup: no base');
    foundColony(sim);
    sim.world.destroy(hq);
    expect(seatBaseOf(sim.world, ctx, SEAT)).toBeNull();
  });

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
});
