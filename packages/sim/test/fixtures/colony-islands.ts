import { type ContentSet, parseContentSet } from '@open-northland/data';
import {
  aiControlEntity,
  COMPUTER_MODULE_IDS,
  type ColonyState,
  ComputerColony,
  type ComputerColonyState,
  type ComputerModuleEnables,
  type EconomicSide,
  FOG_MODE,
  mapBriefOf,
} from '../../src/components/index.js';
import type { DeepReadonly, Entity } from '../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation, type TerrainMap } from '../../src/index.js';
import { seatColonies } from '../../src/systems/ai-shared/home-roster.js';
import type { ColonyEnv } from '../../src/systems/computer-player/colony/voyage.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import {
  BUILDER,
  CARRIER,
  CIVILIST,
  COLLECTOR,
  HQ_TYPE,
  HUNTER,
  MUD,
  makeAiSeat,
  SCOUT,
  SEAT,
  STOCK_TYPE,
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
export const FOOD = 3;
const CARGO_GOODS = [WOOD, MUD, STONE, WHEAT, FOOD];
/** What a warehouse holds of a good, the real one's figure. */
const STORE_SLOT = 45;
/** The hunters a warehouse seats, the real one's figure. */
const HUNTER_SEATS = 3;

/** Cells: the west island, the strait, the east island; rows run the map's height. */
const CELLS = { width: 120, height: 60 };
const STRAIT_FROM_CELL = 44;
const STRAIT_TO_CELL = 70;
const FAR_CELLS = { width: 190, height: 60 };
const FAR_STRAIT_FROM_CELL = 120;
const FAR_STRAIT_TO_CELL = 146;
const CHANNEL_ROW = 50;
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
/** How far east of the east island's deposits the far island's lie, in half-cell nodes. */
const FAR_DEPOSITS_DX = 152;
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
  { good: FOOD, amount: 150 },
];

/** What a seat of two colonies takes on top: a second party's people, and goods for a second manifest. */
const SECOND_PARTY_MEN = 40;
const SECOND_PARTY_WOMEN = 12;
const SECOND_PARTY_GOODS = 2;

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
    buildings: base.buildings.map((b) =>
      b.typeId === STOCK_TYPE
        ? { ...b, stock: CARGO_GOODS.map((goodType) => ({ goodType, capacity: STORE_SLOT, initial: 0 })) }
        : b,
    ),
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

/** {@link colonyContent} whose warehouse offers a hunter seat, as the real one does. */
export function huntingColonyContent(): ContentSet {
  const base = colonyContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: HUNTER, id: 'hunter' }],
    buildings: base.buildings.map((b) =>
      b.typeId === STOCK_TYPE
        ? { ...b, workers: [...b.workers, { jobType: HUNTER, count: HUNTER_SEATS }] }
        : b,
    ),
  });
}

const FISH = 47;
const FISHER = 22;
const FISHER_SEATS = 3;
/** The fishing atomics a fisher plays, the original's. */
const FISHER_ATOMICS = [36, 37, 38];

/** {@link colonyContent} with fish, the fisher trade and the warehouse's fisher seat, as the real one has. */
export function fishingColonyContent(): ContentSet {
  const base = colonyContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: FISH, id: 'fish', weight: 1 }],
    jobs: [...base.jobs, { typeId: FISHER, id: 'fisher', allowedAtomics: FISHER_ATOMICS }],
    buildings: base.buildings.map((b) =>
      b.typeId === STOCK_TYPE
        ? { ...b, workers: [...b.workers, { jobType: FISHER, count: FISHER_SEATS }] }
        : b,
    ),
  });
}

/** The fighter classes of the base fixture: the wooden spear and the short bow, which mans its tower. */
export const SPEARMAN = 32;
export const BOWMAN = 40;

/** What a wooden spear takes off an unarmoured man a blow, and how long its swing lasts in ticks. */
const SPEAR_DAMAGE = 1000;
const SWING_TICKS = 4;
/** The attack atomic a fighter's swing binds, and the event that lands it. */
const ATTACK_ATOMIC = 81;
const HIT_EVENT = 25;

/** {@link colonyContent} whose ships seat the fighters a garrison sails with, and whose spearmen strike. */
export function garrisonContent(): ContentSet {
  const base = colonyContent();
  return parseContentSet({
    ...base,
    vehicles: base.vehicles.map((ship) => ({
      ...ship,
      passengerJobs: [...ship.passengerJobs, SPEARMAN, BOWMAN],
    })),
    weapons: base.weapons.map((w) => (w.jobType === SPEARMAN ? { ...w, damage: { '0': SPEAR_DAMAGE } } : w)),
    tribes: base.tribes.map((t) =>
      t.typeId === VIKING
        ? {
            ...t,
            atomicBindings: [
              ...t.atomicBindings,
              { jobType: SPEARMAN, atomicId: ATTACK_ATOMIC, animation: 'viking_attack' },
            ],
          }
        : t,
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_attack',
        name: 'viking_attack',
        length: SWING_TICKS,
        events: [{ at: SWING_TICKS, type: HIT_EVENT }],
      },
    ],
  });
}

export const SPEAR = 46;
export const ARMORY_TYPE = 50;
const ARMORER = 10;
const SHELF_UNITS = 10;

/** {@link colonyContent} with the armory a seat with no room hands over: spears from wood. */
export function overflowContent(): ContentSet {
  const base = colonyContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: SPEAR, id: 'spear_wooden', weight: 1 }],
    jobs: [...base.jobs, { typeId: ARMORER, id: 'armorer' }],
    vehicles: base.vehicles.map((ship) => ({
      ...ship,
      cargoGoods: [...ship.cargoGoods, SPEAR],
      passengerJobs: [...ship.passengerJobs, ARMORER],
    })),
    buildings: [
      ...base.buildings,
      {
        typeId: ARMORY_TYPE,
        id: 'work_armory_00',
        kind: 'workplace',
        workers: [
          { jobType: ARMORER, count: 1 },
          { jobType: CARRIER, count: 1 },
        ],
        recipes: [
          { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: SPEAR, amount: 1 }], ticks: 180 },
        ],
        construction: [{ goodType: WOOD, amount: 2 }],
        stock: [
          { goodType: WOOD, capacity: SHELF_UNITS, initial: 0 },
          { goodType: SPEAR, capacity: SHELF_UNITS, initial: 0 },
        ],
      },
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

/** {@link colonyIslands} grown east past a second strait, with a channel along the south side joining the
 *  two, so one sea reaches all three islands. */
export function threeIslands(): TerrainMap {
  const { width, height } = FAR_CELLS;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++) {
    for (let col = STRAIT_FROM_CELL; col < width; col++) {
      const strait = col < STRAIT_TO_CELL || (col >= FAR_STRAIT_FROM_CELL && col < FAR_STRAIT_TO_CELL);
      const channel = row >= CHANNEL_ROW && col < FAR_STRAIT_TO_CELL;
      if (strait || channel) typeIds[row * width + col] = WATER;
    }
  }
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
 *  economy, with an empty east island over the strait: everything a colony wants but a ship. With `far`,
 *  a third island past the second strait, deposits like the east's and enough at home for two parties. */
export function colonyWorld(
  seed = 7,
  content: ContentSet = colonyContent(),
  sides: readonly EconomicSide[] = [],
  far = false,
): Simulation {
  const sim = new Simulation({ seed, content, map: far ? threeIslands() : colonyIslands() });
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
    initialGoods: far
      ? HOME_GOODS.map(({ good, amount }) => ({ good, amount: SECOND_PARTY_GOODS * amount }))
      : HOME_GOODS,
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
  const men = far ? MEN + SECOND_PARTY_MEN : MEN;
  const women = far ? WOMEN + SECOND_PARTY_WOMEN : WOMEN;
  for (let i = 0; i < men; i++) person(CIVILIST, i);
  for (let i = 0; i < women; i++) person(WOMAN, men + i);
  for (const dx of far ? [0, FAR_DEPOSITS_DX] : [0]) {
    for (const at of WOOD_AT)
      sim.enqueueSetup({
        kind: 'placeResource',
        good: WOOD,
        ...at,
        x: at.x + dx,
        remaining: WOOD_DEPOSIT,
        harvestAtomic: WOOD_HARVEST,
      });
    for (const at of STONE_AT)
      sim.enqueueSetup({
        kind: 'placeResource',
        good: STONE,
        ...at,
        x: at.x + dx,
        remaining: STONE_DEPOSIT,
        harvestAtomic: STONE_HARVEST,
      });
  }
  makeAiSeat(sim, SEAT, colonyModules());
  seatEconomy(sim, 'islands', sides);
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

/** The seat's colony at `at`, oldest first. */
export function colonyState(sim: Simulation, at = 0): DeepReadonly<ColonyState> | undefined {
  return seatColonies(sim.world, SEAT)[at];
}

/** The seat's first colony, to write to. */
export function editColony(sim: Simulation): ColonyState {
  const carrier = aiControlEntity(sim.world, SEAT);
  const colony = carrier === null ? undefined : sim.world.mut(carrier, ComputerColony).colonies[0];
  if (colony === undefined) throw new Error('setup: no colony');
  return colony;
}

/** A colony with nothing yet, on `land`. */
export function blankColony(land: number, overrides: Partial<ColonyState> = {}): ColonyState {
  return {
    phase: 'running',
    since: 0,
    land,
    site: { hx: 0, hy: 0 },
    shore: null,
    berth: null,
    scout: null,
    ship: null,
    people: [],
    rest: [],
    garrison: [],
    threat: null,
    failures: 0,
    delivered: null,
    builds: [],
    line: null,
    overflow: [],
    stalls: [],
    dangers: [],
    ...overrides,
  };
}

/** The seat's decision over `colony`, one held by no record: for a read that asks only its land. */
export function looseColonyEnv(sim: Simulation, colony: ColonyState): ColonyEnv {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
  const seatState = (): ComputerColonyState => sim.world.mut(carrier, ComputerColony);
  return {
    world: sim.world,
    ctx,
    terrain,
    seat: SEAT,
    carrier,
    colony,
    edit: () => colony,
    editSeat: seatState,
  };
}

/** Step the sim up to `limit` ticks until `done` holds; whether it did. */
export function stepUntil(sim: Simulation, limit: number, done: () => boolean): boolean {
  for (let t = 0; t < limit; t++) {
    if (done()) return true;
    sim.step();
  }
  return done();
}
