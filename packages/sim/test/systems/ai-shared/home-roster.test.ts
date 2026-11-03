import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  Position,
  Settler,
  Stockpile,
  setSettlerJob,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  halfCellMapFromCells,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import {
  colonyBuildingsOn,
  colonySettlersOn,
  homeBuildings,
  homeSettlers,
} from '../../../src/systems/ai-shared/home-roster.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../../src/systems/computer-player/base.js';
import { homeStockOf } from '../../../src/systems/computer-player/colony/stock.js';
import { seatStockOf } from '../../../src/systems/stores/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { blankColony } from '../../fixtures/colony-islands.js';
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

const MAP_CELLS = { width: 110, height: 60 };
const STRAIT_FROM = 22;
const STRAIT_TO = 42;
const FAR_STRAIT_FROM = 70;
const FAR_STRAIT_TO = 90;
const HOME_HQ = { x: 16, y: 20 };
const COLONY_STORE = { x: 110, y: 60 };
const COLONY_HEAP = { x: 118, y: 60 };
const COLONIST_AT = { x: 104, y: 70 };
const SOLDIER_AT = { x: 104, y: 74 };
const FAR_STORE = { x: 200, y: 60 };
const FAR_COLONIST_AT = { x: 196, y: 70 };
const HOME_WOOD = 7;
const COLONY_WOOD = 11;
const COLONY_STONE = 3;

function islandMap() {
  const GRASS = 0;
  const WATER = 1;
  const { width, height } = MAP_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const strait = col >= STRAIT_FROM && col < STRAIT_TO;
      if (strait || (col >= FAR_STRAIT_FROM && col < FAR_STRAIT_TO)) typeIds[row * width + col] = WATER;
    }
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
  const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
  const site = { hx: COLONY_STORE.x, hy: COLONY_STORE.y };
  sim.world.add(carrier, ComputerColony, {
    colonies: [blankColony(land, { site })],
    rejected: [],
    retryAt: 0,
  });
}

/** {@link seatOverSea} with a store and a civilian on a third island and a colony on each of the two. */
function seatWithTwoColonies(): { readonly sim: Simulation; readonly lands: readonly [number, number] } {
  const sim = seatOverSea();
  const built = { force: true, underConstruction: false, tribe: VIKING, owner: SEAT };
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: STOCK_TYPE, ...FAR_STORE, ...built });
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: CIVILIST,
    ...FAR_COLONIST_AT,
    tribe: VIKING,
    owner: SEAT,
  });
  sim.step();
  const carrier = aiControlEntity(sim.world, SEAT);
  const terrain = sim.terrain;
  if (carrier === null || terrain === undefined) throw new Error('setup: no carrier or terrain');
  const near = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
  const far = terrain.componentOf(terrain.nodeAt(FAR_STORE.x, FAR_STORE.y));
  sim.world.add(carrier, ComputerColony, {
    colonies: [blankColony(near), blankColony(far)],
    rejected: [],
    retryAt: 0,
  });
  return { sim, lands: [near, far] };
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

  it('reads a trade change on colony land as a restored game reads it', () => {
    const sim = seatOverSea();
    foundColony(sim);
    const soldier = ownedSettlers(sim.world, SEAT).find(
      (e) => sim.world.get(e, Settler).jobType === SPEARMAN,
    );
    if (soldier === undefined) throw new Error('setup: no soldier');
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toContain(soldier);
    setSettlerJob(sim.world, soldier, CIVILIST);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: aiContent(), map: islandMap() });
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).not.toContain(soldier);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toEqual(homeSettlers(copy.world, ctxOf(copy), SEAT));
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

  it('parts the seat between its colonies, each with its own land', () => {
    const { sim, lands } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const [near, far] = lands;
    const buildings = ownedBuildings(sim.world, SEAT);
    const hq = seatBaseOf(sim.world, ctx, SEAT);
    expect(homeBuildings(sim.world, ctx, SEAT)).toEqual([hq]);
    const nearBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, near);
    const farBuildings = colonyBuildingsOn(sim.world, ctx, SEAT, far);
    expect(nearBuildings).toHaveLength(1);
    expect(farBuildings).toHaveLength(1);
    expect([hq, ...nearBuildings, ...farBuildings].sort((a, b) => Number(a) - Number(b))).toEqual(buildings);
    expect(colonySettlersOn(sim.world, ctx, SEAT, near)).toHaveLength(1);
    expect(colonySettlersOn(sim.world, ctx, SEAT, far)).toHaveLength(1);
    expect(homeSettlers(sim.world, ctx, SEAT)).toHaveLength(2);
  });

  it('counts a man listed for the far colony its own while he still stands at home', () => {
    const { sim, lands } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const [, far] = lands;
    const man = homeSettlers(sim.world, ctx, SEAT).find(
      (e) => sim.world.get(e, Settler).jobType === CIVILIST,
    );
    if (man === undefined) throw new Error('setup: no civilian at home');
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.mut(carrier, ComputerColony).colonies[1]?.rest.push(man);
    expect(colonySettlersOn(sim.world, ctx, SEAT, far)).toContain(man);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(man);
  });

  it('keeps a colony write off another seat', () => {
    const { sim } = seatWithTwoColonies();
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    const before = homeSettlers(sim.world, ctx, SEAT);
    const other = sim.world.create();
    sim.world.add(other, ComputerColony, { colonies: [], rejected: [], retryAt: 0 });
    sim.world.mut(other, ComputerColony).retryAt = 1;
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(before);
    sim.world.mut(carrier, ComputerColony).retryAt = 1;
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toBe(before);
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
