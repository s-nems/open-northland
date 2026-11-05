import { aiControlEntity, ComputerColony } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../src/index.js';
import { ownedBuildings } from '../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../src/systems/computer-player/base.js';
import {
  CIVILIST,
  HQ_TYPE,
  makeAiSeat,
  SEAT,
  SPEARMAN,
  STOCK_TYPE,
  VIKING,
} from '../systems/computer-player/support.js';
import { aiContent } from './ai-content.js';
import { blankColony } from './colony-islands.js';
import { ctxOf } from './context.js';

const MAP_CELLS = { width: 110, height: 60 };
const STRAIT_FROM = 22;
export const STRAIT_TO = 42;
const FAR_STRAIT_FROM = 70;
const FAR_STRAIT_TO = 90;
export const HOME_HQ = { x: 16, y: 20 };
const COLONY_STORE = { x: 110, y: 60 };
export const COLONIST_AT = { x: 104, y: 70 };
const SOLDIER_AT = { x: 104, y: 74 };
const FAR_STORE = { x: 200, y: 60 };
const FAR_COLONIST_AT = { x: 196, y: 70 };

export function islandMap() {
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
export function seatOverSea(): Simulation {
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

export function foundColony(sim: Simulation): void {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no carrier');
  const land = colonyLand(sim);
  const site = { hx: COLONY_STORE.x, hy: COLONY_STORE.y };
  sim.world.add(carrier, ComputerColony, {
    colonies: [blankColony(land, { site })],
    rejected: [],
    retryAt: 0,
  });
}

/** {@link seatOverSea} with a store and a civilian on a third island and a colony on each of the two. */
export function seatWithTwoColonies(): {
  readonly sim: Simulation;
  readonly lands: readonly [number, number];
} {
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

export function colonyLand(sim: Simulation): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  return terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
}

export function storeOnColony(sim: Simulation): Entity {
  const store = ownedBuildings(sim.world, SEAT).find((e) => e !== seatBaseOf(sim.world, ctxOf(sim), SEAT));
  if (store === undefined) throw new Error('setup: no colony store');
  return store;
}
