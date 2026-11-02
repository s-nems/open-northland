import { type ContentSet, parseContentSet } from '@open-northland/data';
import {
  aiControlEntity,
  COMPUTER_MODULE_IDS,
  ComputerColony,
  type ComputerColonyState,
  type ComputerModuleEnables,
  FOG_MODE,
  mapBriefOf,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation, type TerrainMap } from '../../src/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import {
  BUILDER,
  CARRIER,
  CIVILIST,
  COLLECTOR,
  HQ_TYPE,
  MUD,
  makeAiSeat,
  SCOUT,
  SEAT,
  STONE,
  STONE_HARVEST,
  seatEconomy,
  VIKING,
  WOMAN,
  WOOD,
  WOOD_HARVEST,
} from '../systems/computer-player/support.js';
import { aiContent } from './ai-content.js';
import { ctxOf } from './context.js';

export const SMALL_SHIP = 3;
export const BIG_SHIP = 4;
const HOLD_SMALL = 50;
const HOLD_BIG = 200;
const SEATS_SMALL = 19;
const SEATS_BIG = 9;
const SHIP_FOOTPRINT = 2;
const DOOR = { direction: 2, distance: 4 };
const HULL = 5000;
const CREW_JOBS = [WOMAN, CIVILIST, BUILDER, COLLECTOR, CARRIER, SCOUT];
export const WHEAT = 44;
const TRADE_SHIP_GOOD = 45;
const CARGO_GOODS = [WOOD, MUD, STONE, WHEAT];

/** Cells: the west island, the strait, the east island; rows run the map's height. */
const CELLS = { width: 120, height: 60 };
const STRAIT_FROM_CELL = 44;
const STRAIT_TO_CELL = 70;
const GRASS = 0;
const WATER = 1;

/** Half-cell nodes: the seat's headquarters by the west shore, a ship off it, the east island's deposits. */
const HQ_AT = { x: 72, y: 60 };
export const SHIP_AT = { x: 90, y: 60 };
const WOOD_AT = [
  { x: 176, y: 40 },
  { x: 176, y: 56 },
  { x: 176, y: 72 },
  { x: 176, y: 88 },
];
const STONE_AT = [
  { x: 192, y: 48 },
  { x: 192, y: 72 },
];
const WOOD_DEPOSIT = 100;
const STONE_DEPOSIT = 100;
/** The men and women on the seat's home island, in rows west of the headquarters. */
const MEN = 40;
const WOMEN = 12;
const SPAWN_ROW = 20;
const SPAWN_LEFT = 8;
const SPAWN_TOP = 40;
const SPAWN_STEP = 2;
/** The goods at home: more than a colony's manifest of each. */
const HOME_GOODS = [
  { good: WOOD, amount: 60 },
  { good: STONE, amount: 30 },
  { good: MUD, amount: 30 },
  { good: WHEAT, amount: 30 },
];

/** Two ship types that seat every civilian trade and carry the building goods, sized as the real ones. */
export function colonyContent(tradeShip = false): ContentSet {
  const ship = (typeId: number, id: string, stockSlots: number, passengerSlots: number) => ({
    typeId,
    id,
    jobId: 52,
    stockSlots,
    passengerSlots,
    logicSize: SHIP_FOOTPRINT,
    passengerJobs: CREW_JOBS,
    cargoGoods: CARGO_GOODS,
    commanderJob: CARRIER,
    passengerVector: DOOR,
    hitpoints: HULL,
  });
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WHEAT, id: 'wheat', weight: 1 },
      ...(tradeShip ? [{ typeId: TRADE_SHIP_GOOD, id: 'ship_big', weight: 0 }] : []),
    ],
    vehicles: [
      ship(SMALL_SHIP, 'ship_small', HOLD_SMALL, SEATS_SMALL),
      ship(BIG_SHIP, 'ship_big', HOLD_BIG, SEATS_BIG),
    ],
  });
}

export function colonyIslands(): TerrainMap {
  const { width, height } = CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = STRAIT_FROM_CELL; col < STRAIT_TO_CELL; col++) typeIds[row * width + col] = WATER;
  return halfCellMapFromCells({ width, height, typeIds });
}

/** Only what a colony needs of the computer player runs, so the scenario shows the voyage alone. */
function colonyModules(): Partial<ComputerModuleEnables> {
  const modules: Partial<ComputerModuleEnables> = {};
  for (const id of COMPUTER_MODULE_IDS)
    modules[id] = id === 'houseBuild' || id === 'collectResources' || id === 'guideBuild';
  return modules;
}

/** A seat of civilians alone on the west island, no rival, no soldier, goods at home and an islands
 *  economy, with an empty east island over the strait: everything a colony wants but a ship. */
export function colonyWorld(seed = 7, content: ContentSet = colonyContent()): Simulation {
  const sim = new Simulation({ seed, content, map: colonyIslands() });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    ...HQ_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
    initialGoods: HOME_GOODS,
  });
  const person = (jobType: number, i: number) =>
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType,
      x: SPAWN_LEFT + SPAWN_STEP * (i % SPAWN_ROW),
      y: SPAWN_TOP + SPAWN_STEP * Math.floor(i / SPAWN_ROW),
      tribe: VIKING,
      owner: SEAT,
    });
  for (let i = 0; i < MEN; i++) person(CIVILIST, i);
  for (let i = 0; i < WOMEN; i++) person(WOMAN, MEN + i);
  for (const at of WOOD_AT)
    sim.enqueueSetup({
      kind: 'placeResource',
      good: WOOD,
      ...at,
      remaining: WOOD_DEPOSIT,
      harvestAtomic: WOOD_HARVEST,
    });
  for (const at of STONE_AT)
    sim.enqueueSetup({
      kind: 'placeResource',
      good: STONE,
      ...at,
      remaining: STONE_DEPOSIT,
      harvestAtomic: STONE_HARVEST,
    });
  makeAiSeat(sim, SEAT, colonyModules());
  seatEconomy(sim, 'islands');
  sim.step();
  if (mapBriefOf(sim.world) === null) throw new Error('setup: the map brief is not taken');
  return sim;
}

/** A ship of the seat off the west shore. */
export function mooredShip(sim: Simulation, vehicleType = SMALL_SHIP, at = SHIP_AT): Entity {
  const ship = createVehicle(sim.world, ctxOf(sim), { vehicleType, ...at, tribe: VIKING, owner: SEAT });
  if (ship === null) throw new Error('setup: no ship');
  return ship;
}

export function colonyState(sim: Simulation): Readonly<ComputerColonyState> | undefined {
  const carrier = aiControlEntity(sim.world, SEAT);
  return carrier === null
    ? undefined
    : (sim.world.tryGet(carrier, ComputerColony) as Readonly<ComputerColonyState>);
}

/** Step the sim up to `limit` ticks until `done` holds; whether it did. */
export function stepUntil(sim: Simulation, limit: number, done: () => boolean): boolean {
  for (let t = 0; t < limit; t++) {
    if (done()) return true;
    sim.step();
  }
  return done();
}
