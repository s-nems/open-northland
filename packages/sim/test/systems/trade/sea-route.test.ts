import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  goodsTradedWith,
  HaulingCart,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  Stockpile,
  seatPassenger,
  TradeRoute,
  TradeShip,
  Vehicle,
  VehicleDrive,
  VehicleStock,
  vehicleCommander,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  type HalfCellNode,
  halfCellMapFromCells,
  nodeOfPosition,
  ONE,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../../src/index.js';
import { hexagonRing, hexDistance } from '../../../src/nav/halfcell.js';
import { interactionNode, vehicleAnchor } from '../../../src/systems/footprint/index.js';
import { removeSettlerSilently } from '../../../src/systems/lifecycle/death.js';
import { TRADE_DOCK_RETRY_TICKS } from '../../../src/systems/trade/index.js';
import { mooringTargetOf } from '../../../src/systems/trade/ship.js';
import { createVehicle, removeVehicle } from '../../../src/systems/vehicles/index.js';
import {
  cargoHandHasWork,
  consumeVehicleGood,
  stockVehicleGoods,
} from '../../../src/systems/vehicles/stock.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

/**
 * A trader's route across the sea on a ship the player pinned to it: the goods ride in the ship and the
 * cart or hands, the trader ferries them between the warehouse and the ship in several trips, and the
 * ship sails with the cart in its vehicle slot. Two islands with a strait between them.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const TRADER = 25;
const SMITH = 13;
const HANDCART = 1;
const HANDCART_HOLD = 15;
const SHIP_SMALL = 3;
const SHIP_BIG = 4;
const CATAPULT = 5;
const WOOD = 1;
const PLANK = 2;
const FOOD = 3;
const HEADQUARTERS = 1;
const GRASS = 0;
const WATER = 1;
const MAP_W = 24;
const MAP_H = 16;
/** The strait's cells: the west island ends at cell 7, the east island starts at cell 16. */
const STRAIT_FROM = 8;
const STRAIT_TO = 16;
/** A strait node a moored ship spawns on, its door on the west shore. */
const WEST_SHIP_X = 18;
const SHIP_ROW = 16;
const WEST_HOUSE_CELL = 5;
const EAST_HOUSE_CELL = 18;
const HOUSE_ROW = 8;
const SOUTH_ROW = 3;
const SOUTH_WEST_HOUSE_CELL = 2;
/** The node row of a ship moored far along the shore from a house on {@link SOUTH_ROW}. */
const FAR_SOUTH_ROW = 26;
/** Long enough to show a trader stays put. */
const WAIT_TICKS = 600;
const TRADING_POST_ID = 700;
const SCOUT = 27;
const BIG_SHIP_JOB = 53;
const BIG_SHIP_SLOTS = 200;
const CATAPULT_JOB = 54;
const OXCART_JOB = 51;
/** Rows between two ships moored side by side. */
const FLEET_ROWS = 10;
/** A strait node a moored ship spawns on, its door on the east shore. */
const EAST_SHIP_X = 28;
/** Open water for a player's goto. */
const OPEN_WATER_X = 24;
const NORTH_WATER_Y = 6;
const SMALL_LOAD = 4;
const FOOT_LOAD = 3;
const SHIP_PLANKS = 7;
const FOOD_ABOARD = 3;
/** The ship's door distance. */
const DOOR_DISTANCE = 4;
/** Failed docks a test waits for. */
const COOLDOWNS = 2;
/** More wood than a handcart's fifteen, less than a small ship's fifty. */
const LOAD = 22;
/** A voyage's worth of ticks, several ferry trips included. */
const VOYAGE_TICKS = 2500;
const LONG_TICKS = 6000;
const TICK_STEP = 10;

function islandMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(GRASS);
  for (let row = 0; row < MAP_H; row++) {
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * MAP_W + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds });
}

function newSim(content: ContentSet = testContent()): Simulation {
  const sim = new Simulation({ seed: 3, content, map: islandMap() });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

function houseAt(
  sim: Simulation,
  cell: number,
  owner: number,
  stock: Array<[number, number]> = [],
  row = HOUSE_ROW,
  missionId?: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(cell), y: fx.fromInt(row) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: owner });
  if (missionId !== undefined) sim.world.add(e, MissionObjectId, { id: missionId });
  return e;
}

function traderAt(sim: Simulation, cell: number, row = HOUSE_ROW + 2, jobType = TRADER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(cell), y: fx.fromInt(row) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function vehicleAt(sim: Simulation, vehicleType: number, hx: number, hy: number, owner = HUMAN): Entity {
  const e = createVehicle(sim.world, ctxOf(sim), { vehicleType, x: hx, y: hy, tribe: VIKING, owner });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function order(sim: Simulation, command: Parameters<typeof playerCommand>[1]): void {
  sim.enqueue(playerCommand(HUMAN, command));
}

function pin(sim: Simulation, trader: Entity, ship: Entity | null): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeShip', entity: trader, ship }));
}

function attach(sim: Simulation, trader: Entity, house: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house }));
}

function mark(sim: Simulation, trader: Entity, house: Entity, good: number): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house, good, on: true }));
}

/** A trader on the west island with a handcart beside it and a small ship pinned at the west shore. */
function crossing(sim: Simulation, opts: { readonly cart?: boolean; readonly type?: number } = {}) {
  const trader = traderAt(sim, WEST_HOUSE_CELL);
  const ship = vehicleAt(sim, opts.type ?? SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
  const cart =
    opts.cart === false ? null : vehicleAt(sim, HANDCART, 2 * WEST_HOUSE_CELL, 2 * (HOUSE_ROW + 2));
  if (cart !== null) order(sim, { kind: 'attachToVehicle', entity: trader, vehicle: cart });
  pin(sim, trader, ship);
  return { trader, ship, cart };
}

/** Step until `done` holds, by small steps, or the limit runs out. */
function runUntil(sim: Simulation, limit: number, done: () => boolean): void {
  for (let elapsed = 0; elapsed < limit && !done(); elapsed += TICK_STEP) sim.run(TICK_STEP);
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

function aboard(sim: Simulation, vehicle: Entity, good: number): number {
  return sim.world.get(vehicle, VehicleStock).lines.get(good)?.current ?? 0;
}

function continentOf(sim: Simulation, e: Entity): number {
  const pos = sim.world.get(e, Position);
  const at = nodeOfPosition(pos.x, pos.y);
  const terrain = ctxOf(sim).terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  return terrain.componentOf(terrain.nodeAt(at.hx, at.hy));
}

/** Friendship both ways between the trader's player and the neighbour. */
function befriend(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'friend' });
}

/** The agreement the trading post offers: {@link LOAD} wood for as many planks. */
function offerWoodForPlanks(sim: Simulation): void {
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: TRADING_POST_ID,
    giveGood: WOOD,
    giveAmount: LOAD,
    takeGood: PLANK,
    takeAmount: LOAD,
  });
}

/** The fixture content with the big ship row the pipeline builds: one vehicle slot, the two carts. */
function withBigShip(content: ContentSet): ContentSet {
  const small = content.vehicles.find((type) => type.typeId === SHIP_SMALL);
  if (small === undefined) throw new Error('small ship not in the fixture');
  return parseContentSet({
    ...content,
    manifest: TEST_MANIFEST,
    vehicles: [
      ...content.vehicles,
      {
        ...small,
        typeId: SHIP_BIG,
        id: 'ship_big',
        jobId: BIG_SHIP_JOB,
        stockSlots: BIG_SHIP_SLOTS,
        passengerJobs: [...small.passengerJobs.filter((job) => job !== CATAPULT_JOB), OXCART_JOB],
      },
    ],
  });
}

/** A loaded trader on a route to the east island, stepped until it sails. */
function sailing() {
  const sim = newSim();
  const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
  const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
  const { trader, ship, cart } = crossing(sim);
  attach(sim, trader, west);
  attach(sim, trader, east);
  mark(sim, trader, east, WOOD);
  if (cart === null) throw new Error('no cart');
  runUntil(sim, VOYAGE_TICKS, () => sim.world.has(ship, VehicleDrive));
  if (!sim.world.has(ship, VehicleDrive)) throw new Error('the ship never cast off');
  return { sim, trader, ship, cart, west, east };
}

/** A trader aboard its pinned ship, stepped to the tick it lies moored with the cart in the slot. */
function aboardMoored() {
  const sim = newSim();
  const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
  const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
  const { trader, ship, cart } = crossing(sim);
  attach(sim, trader, west);
  attach(sim, trader, east);
  mark(sim, trader, east, WOOD);
  if (cart === null) throw new Error('no cart');
  for (let elapsed = 0; elapsed < VOYAGE_TICKS && !sim.world.has(trader, Rider); elapsed++) sim.step();
  if (!sim.world.has(trader, Rider)) throw new Error('the trader never boarded');
  return { sim, trader, ship, cart, west, east };
}

/** The reasons of this tick's refused vehicle moves. */
function refusalsOf(sim: Simulation, vehicle?: Entity): string[] {
  return sim.events
    .current()
    .flatMap((ev) =>
      ev.kind === 'vehicleMoveRefused' && (vehicle === undefined || ev.entity === vehicle) ? [ev.reason] : [],
    );
}

/** A loaded route to the east island whose stop's mooring has a ship lying on all its dock nodes. */
function blockedVoyage() {
  const sim = newSim();
  const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
  const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
  const { trader, ship } = crossing(sim);
  attach(sim, trader, west);
  attach(sim, trader, east);
  mark(sim, trader, east, WOOD);
  sim.step();
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  const door = interactionNode(sim.world, ctx, east);
  if (door === null) throw new Error('house with no door');
  const target = mooringTargetOf(sim.world, ctx, terrain, ship, terrain.nodeAt(door.x, door.y));
  if (target === null) throw new Error('no mooring on the east shore');
  const { x, y } = terrain.coordsOf(target);
  const water = [...hexagonRing({ hx: x, hy: y }, DOOR_DISTANCE)]
    .map(({ point }) => point)
    .filter((p) => terrain.inBounds(p.hx, p.hy) && !terrain.isWalkable(terrain.nodeAt(p.hx, p.hy)));
  const middle = water[Math.floor(water.length / 2)];
  if (middle === undefined) throw new Error('no water on the ring');
  const blocker = vehicleAt(sim, SHIP_SMALL, middle.hx, middle.hy, NEIGHBOUR);
  return { sim, trader, ship, east, blocker };
}

function mooringOf(sim: Simulation, ship: Entity): HalfCellNode {
  const mooring = sim.world.get(ship, Vehicle).mooring;
  if (mooring === null) throw new Error('the ship lies at sea');
  return mooring;
}

function doorOf(sim: Simulation, house: Entity): HalfCellNode {
  const door = interactionNode(sim.world, ctxOf(sim), house);
  if (door === null) throw new Error('house with no door');
  return { hx: door.x, hy: door.y };
}

function expectSound(sim: Simulation): void {
  expect(sim.checkInvariants()).toEqual([]);
}

describe('a pinned ship on a route between two islands', () => {
  it('ferries more than the near hold takes to the other island in one voyage, the cart in the slot, both ways', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN, [[PLANK, LOAD]]);
    const { trader, ship, cart } = crossing(sim);
    attach(sim, trader, west);
    attach(sim, trader, east);
    mark(sim, trader, east, WOOD);
    mark(sim, trader, west, PLANK);
    if (cart === null) throw new Error('no cart');

    let cartRodeTheSlot = false;
    let riddenOut: number | undefined;
    let fullestCart = 0;
    runUntil(sim, LONG_TICKS, () => {
      const seated = sim.world.tryGet(trader, Rider)?.vehicle === ship;
      if (seated && !sim.world.has(cart, Position)) {
        cartRodeTheSlot ||= sim.world.get(ship, Vehicle).vehicles.some((s) => s?.entity === cart);
        riddenOut ??= aboard(sim, ship, WOOD) + aboard(sim, cart, WOOD);
      }
      const onEastIsland =
        sim.world.has(trader, Position) && continentOf(sim, trader) === continentOf(sim, east);
      if (onEastIsland) fullestCart = Math.max(fullestCart, aboard(sim, cart, WOOD));
      return stockOf(sim, east, WOOD) === LOAD && stockOf(sim, west, PLANK) === LOAD;
    });

    expect(stockOf(sim, east, WOOD)).toBe(LOAD);
    expect(stockOf(sim, west, PLANK)).toBe(LOAD);
    expect(riddenOut).toBe(LOAD);
    expect(cartRodeTheSlot).toBe(true);
    expect(fullestCart).toBe(HANDCART_HOLD);
    expectSound(sim);
  });

  it('runs a foreign agreement over the sea, the give and the take each past the near hold, and counts both', () => {
    const sim = newSim();
    befriend(sim);
    offerWoodForPlanks(sim);
    const home = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const post = houseAt(sim, EAST_HOUSE_CELL, NEIGHBOUR, [[PLANK, LOAD]], HOUSE_ROW, TRADING_POST_ID);
    const { trader, cart } = crossing(sim);
    attach(sim, trader, home);
    attach(sim, trader, post);
    order(sim, { kind: 'setTradeAgreement', entity: trader, agreement: 0 });
    if (cart === null) throw new Error('no cart');

    let peakGiven = 0;
    let fullestCart = 0;
    runUntil(sim, LONG_TICKS, () => {
      peakGiven = Math.max(peakGiven, sim.world.tryGet(trader, TradeRoute)?.given ?? 0);
      const onEastIsland =
        sim.world.has(trader, Position) && continentOf(sim, trader) === continentOf(sim, post);
      if (onEastIsland) fullestCart = Math.max(fullestCart, aboard(sim, cart, WOOD));
      return stockOf(sim, home, PLANK) === LOAD;
    });

    expect(stockOf(sim, post, WOOD)).toBe(LOAD);
    expect(peakGiven).toBe(LOAD);
    expect(fullestCart).toBe(HANDCART_HOLD);
    expect(stockOf(sim, home, PLANK)).toBe(LOAD);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(LOAD);
    expectSound(sim);
  });

  it('crosses on foot with one unit in the hands a trip, the rest in the ship', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, FOOT_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship } = crossing(sim, { cart: false });
    attach(sim, trader, west);
    attach(sim, trader, east);
    mark(sim, trader, east, WOOD);

    let sailedWith = 0;
    runUntil(sim, LONG_TICKS, () => {
      if (sim.world.has(ship, VehicleDrive)) sailedWith = aboard(sim, ship, WOOD);
      return stockOf(sim, east, WOOD) === FOOT_LOAD;
    });

    expect(sailedWith).toBe(FOOT_LOAD);
    expect(stockOf(sim, east, WOOD)).toBe(FOOT_LOAD);
    expect(sim.world.get(ship, VehicleStock).lines.get(WOOD)?.current ?? 0).toBe(0);
  });

  it('ignores the ship and its hold on a route between houses of one island', () => {
    const sim = newSim();
    const near = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const far = houseAt(sim, SOUTH_WEST_HOUSE_CELL, HUMAN, [], SOUTH_ROW);
    const { trader, ship } = crossing(sim);
    stockVehicleGoods(sim.world, ship, ctxOf(sim).content, PLANK, SHIP_PLANKS);
    attach(sim, trader, near);
    attach(sim, trader, far);
    mark(sim, trader, far, WOOD);

    let boarded = false;
    runUntil(sim, LONG_TICKS, () => {
      boarded ||= sim.world.has(trader, Rider);
      return stockOf(sim, far, WOOD) === LOAD;
    });

    expect(stockOf(sim, far, WOOD)).toBe(LOAD);
    expect(boarded).toBe(false);
    expect(aboard(sim, ship, PLANK)).toBe(SHIP_PLANKS);
    expect(aboard(sim, ship, WOOD)).toBe(0);
    expect(sim.traderView(trader)?.shipState).toBe('notNeeded');
  });
});

describe('where the trader and its ship stand', () => {
  it('sails a ship lying away along the shore round to the stop, once, before it ferries', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]], SOUTH_ROW);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN, [], SOUTH_ROW);
    const trader = traderAt(sim, WEST_HOUSE_CELL, SOUTH_ROW + 2);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, FAR_SOUTH_ROW);
    pin(sim, trader, ship);
    attach(sim, trader, west);
    attach(sim, trader, east);
    mark(sim, trader, east, WOOD);
    sim.step();
    const before = hexDistance(mooringOf(sim, ship), doorOf(sim, west));

    runUntil(
      sim,
      VOYAGE_TICKS,
      () => sim.world.get(ship, Vehicle).moored && stockOf(sim, west, WOOD) < SMALL_LOAD,
    );

    expect(sim.world.get(trader, TradeRoute).current).toBe(0);
    expect(hexDistance(mooringOf(sim, ship), doorOf(sim, west))).toBeLessThan(before);
  });

  it('takes the stop on its own island as current and waits while the ship lies across the sea', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    const across = vehicleAt(sim, SHIP_SMALL, EAST_SHIP_X, SHIP_ROW);
    pin(sim, trader, ship);
    attach(sim, trader, east);
    attach(sim, trader, west);
    mark(sim, trader, west, WOOD);
    sim.step();
    sim.world.mut(ship, Vehicle).mooring = sim.world.get(across, Vehicle).mooring;

    sim.run(TICK_STEP);
    expect(sim.world.get(trader, TradeRoute).stops[sim.world.get(trader, TradeRoute).current]?.house).toBe(
      west,
    );
    expect(sim.traderView(trader)?.shipState).toBe('unreachable');
    sim.run(WAIT_TICKS);
    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(stockOf(sim, west, WOOD)).toBe(0);
  });

  it('survives a save taken mid-voyage with the cart in the slot', () => {
    const { sim, trader, ship, cart, east } = sailing();
    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: islandMap(),
    });

    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.world.get(trader, TradeShip).vehicle).toBe(ship);
    expect(restored.world.get(cart, Vehicle).carrier).toBe(ship);
    runUntil(restored, VOYAGE_TICKS, () => stockOf(restored, east, WOOD) > 0);
    expect(stockOf(restored, east, WOOD)).toBeGreaterThan(0);
  });
});

describe('the pin', () => {
  it("admits a trader's own empty moored ship with a free vehicle slot on its island only", () => {
    const sim = newSim();
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const smith = traderAt(sim, WEST_HOUSE_CELL, HOUSE_ROW + 3, SMITH);
    const free = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    const cart = vehicleAt(sim, HANDCART, 2 * WEST_HOUSE_CELL, 2 * SOUTH_ROW);
    const foreign = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW + FLEET_ROWS, NEIGHBOUR);
    const crewed = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW - FLEET_ROWS);
    seatPassenger(sim.world, crewed, smith);
    const across = vehicleAt(sim, SHIP_SMALL, EAST_SHIP_X, SHIP_ROW);
    sim.step();

    expect(sim.canPinTradeShip(trader, free)).toBe(true);
    expect(sim.canPinTradeShip(smith, free)).toBe(false);
    expect(sim.canPinTradeShip(trader, cart)).toBe(false);
    expect(sim.canPinTradeShip(trader, foreign)).toBe(false);
    expect(sim.canPinTradeShip(trader, crewed)).toBe(false);
    expect(sim.canPinTradeShip(trader, across)).toBe(false);
    expect(sim.tradeShipsPinnableBy(trader)).toEqual([free]);
  });

  it('sets the hold to what is aboard, so no cargo order flushes it, and refuses a second trader', () => {
    const sim = newSim();
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const rival = traderAt(sim, WEST_HOUSE_CELL, HOUSE_ROW + 3);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    order(sim, { kind: 'setVehicleWanted', vehicle: ship, goodType: WOOD, amount: LOAD });
    sim.step();
    pin(sim, trader, ship);
    sim.step();

    const line = sim.world.get(ship, VehicleStock).lines.get(WOOD);
    expect(line).toMatchObject({ current: 0, wanted: 0, reserved: 0 });
    expect(sim.world.get(ship, Vehicle).hauler).toBe(trader);
    expect(sim.canPinTradeShip(rival, ship)).toBe(false);
  });

  it('keeps everyone else off a pinned ship and out of its slot until the unpin', () => {
    const content = withBigShip(testContent());
    const sim = newSim(content);
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const scout = traderAt(sim, WEST_HOUSE_CELL, HOUSE_ROW + 3, SCOUT);
    const ship = vehicleAt(sim, SHIP_BIG, WEST_SHIP_X, SHIP_ROW);
    const cart = vehicleAt(sim, HANDCART, 2 * WEST_HOUSE_CELL, 2 * SOUTH_ROW);
    pin(sim, trader, ship);
    sim.step();

    order(sim, { kind: 'attachToVehicle', entity: scout, vehicle: ship });
    order(sim, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship });
    sim.step();
    expect(sim.world.has(scout, Rider)).toBe(false);
    expect(sim.world.get(cart, Vehicle).carrier).toBeNull();
    expect(sim.canAttachToVehicle(scout, ship)).toBe(false);

    pin(sim, trader, null);
    sim.step();
    expect(sim.world.has(trader, TradeShip)).toBe(false);
    expect(sim.world.get(ship, Vehicle).hauler).toBeNull();
    expect(sim.canAttachToVehicle(scout, ship)).toBe(true);
  });

  it('leaves an unpinned trader aboard a plain commander and its cart a plain carried vehicle', () => {
    const { sim, trader, ship, cart } = aboardMoored();

    pin(sim, trader, null);
    sim.step();

    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBe(trader);
    expect(sim.world.has(trader, HaulingCart)).toBe(false);
    expect(sim.world.get(cart, Vehicle)).toMatchObject({ carrier: ship, hauler: null });
    expectSound(sim);
  });

  it('drops when the trader changes trade or dies', () => {
    const sim = newSim();
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const heir = traderAt(sim, WEST_HOUSE_CELL, HOUSE_ROW + 3);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    pin(sim, trader, ship);
    sim.step();

    order(sim, { kind: 'setJob', entity: trader, jobType: SMITH });
    sim.step();
    expect(sim.world.has(trader, TradeShip)).toBe(false);
    expect(sim.world.get(ship, Vehicle).hauler).toBeNull();

    pin(sim, heir, ship);
    sim.step();
    removeSettlerSilently(sim.world, heir);
    expect(sim.world.get(ship, Vehicle).hauler).toBeNull();
    expectSound(sim);
  });

  it("drops once the ship is another player's", () => {
    const sim = newSim();
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    pin(sim, trader, ship);
    sim.step();

    sim.world.mut(ship, Owner).player = NEIGHBOUR;
    sim.step();

    expect(sim.world.has(trader, TradeShip)).toBe(false);
    expect(sim.world.get(ship, Vehicle).hauler).toBeNull();
  });
});

describe('the big ship', () => {
  it('takes a cart through the load order and refuses a catapult', () => {
    const sim = newSim(withBigShip(testContent()));
    const ship = vehicleAt(sim, SHIP_BIG, WEST_SHIP_X, SHIP_ROW);
    const catapult = vehicleAt(sim, CATAPULT, 2 * WEST_HOUSE_CELL, 2 * SOUTH_ROW);
    order(sim, { kind: 'loadIntoVehicle', vehicle: catapult, carrier: ship });
    sim.step();
    expect(sim.world.get(catapult, Vehicle).carrier).toBeNull();

    const cart = vehicleAt(sim, HANDCART, 2 * (WEST_HOUSE_CELL + 1), 2 * SOUTH_ROW);
    order(sim, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship });
    sim.step();
    expect(sim.world.get(cart, Vehicle).carrier).toBe(ship);
  });
});

describe('a pinned ship lost', () => {
  it('at sea takes the cart and the trader down with it, the pin gone', () => {
    const { sim, trader, ship, cart } = sailing();

    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');

    expect(sim.world.isAlive(trader)).toBe(false);
    expect(sim.world.isAlive(cart)).toBe(false);
    expectSound(sim);
  });

  it('at the shore sets the cart down and the trader on it, the pin gone', () => {
    const { sim, trader, ship, cart } = aboardMoored();

    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');

    expect(sim.world.has(trader, TradeShip)).toBe(false);
    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(sim.world.has(trader, Position)).toBe(true);
    expect(sim.world.get(cart, Vehicle).carrier).toBeNull();
    expect(sim.world.has(cart, Position)).toBe(true);
    expect(sim.world.get(trader, HaulingCart).vehicle).toBe(cart);
    expectSound(sim);
  });
});

describe("a player's order on a voyage", () => {
  it('to the ship runs to its end, then the trader resumes the route', () => {
    const { sim, trader, ship, east } = sailing();
    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: NORTH_WATER_Y });

    runUntil(sim, VOYAGE_TICKS, () => {
      const at = vehicleAnchor(sim.world, ship);
      return at !== null && at.hx === OPEN_WATER_X && at.hy === NORTH_WATER_Y;
    });
    expect(sim.world.get(trader, Rider).vehicle).toBe(ship);

    runUntil(sim, VOYAGE_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
    expectSound(sim);
  });

  it('to stop holds the ship at sea until the next order, and that order leads back to the route', () => {
    const { sim, trader, ship, east } = sailing();
    order(sim, { kind: 'stopVehicle', vehicle: ship });
    sim.run(WAIT_TICKS);

    expect(sim.world.has(ship, VehicleDrive)).toBe(false);
    expect(sim.world.get(ship, Vehicle).moored).toBe(false);

    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: NORTH_WATER_Y });
    runUntil(sim, LONG_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(sim.world.tryGet(trader, Rider)).toBeUndefined();
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
  });

  it('to walk on a moored ship lands the trader and its cart, and the route takes it back up', () => {
    const { sim, trader, ship, cart, east } = aboardMoored();
    order(sim, { kind: 'moveUnit', entity: trader, x: 2 * WEST_HOUSE_CELL, y: 2 * HOUSE_ROW });
    sim.step();

    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(sim.world.has(trader, Position)).toBe(true);
    expect(sim.world.get(cart, Vehicle).carrier).toBeNull();
    expect(sim.world.has(cart, Position)).toBe(true);
    expect(sim.world.get(ship, Vehicle).vehicles.every((seat) => seat === null)).toBe(true);
    expectSound(sim);

    runUntil(sim, LONG_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
    expectSound(sim);
  });
});

describe("a player's order to a moored pinned ship with its trader ashore", () => {
  /** A loaded route with the trader and its cart still at the west house and the ship held on an order. */
  function ordered() {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, cart } = crossing(sim);
    attach(sim, trader, west);
    attach(sim, trader, east);
    mark(sim, trader, east, WOOD);
    if (cart === null) throw new Error('no cart');
    sim.step();
    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: NORTH_WATER_Y });
    sim.step();
    expect(refusalsOf(sim, ship)).toEqual([]);
    expect(sim.world.get(ship, Vehicle).heldGoal).not.toBeNull();
    return { sim, trader, ship, cart, east };
  }

  it('brings the trader and its cart aboard, sails to the point, then the trader goes back to its route', () => {
    const { sim, trader, ship, cart, east } = ordered();

    const atPoint = (): boolean => {
      const at = vehicleAnchor(sim.world, ship);
      return at !== null && at.hx === OPEN_WATER_X && at.hy === NORTH_WATER_Y;
    };
    runUntil(sim, VOYAGE_TICKS, atPoint);
    expect(atPoint()).toBe(true);
    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBe(trader);
    expect(sim.world.get(cart, Vehicle).carrier).toBe(ship);

    runUntil(sim, LONG_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
    expectSound(sim);
  });

  it('docks on the order of a pin with no route, and the trader steps ashore there', () => {
    const sim = newSim();
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship } = crossing(sim, { cart: false });
    sim.step();
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    const door = doorOf(sim, east);
    const target = mooringTargetOf(sim.world, ctx, terrain, ship, terrain.nodeAt(door.hx, door.hy));
    if (target === null) throw new Error('no mooring on the east shore');
    const { x, y } = terrain.coordsOf(target);
    order(sim, { kind: 'dockVehicle', vehicle: ship, x, y });

    runUntil(
      sim,
      VOYAGE_TICKS,
      () => sim.world.get(ship, Vehicle).mooring?.hx === x && sim.world.has(trader, Position),
    );
    expect(sim.world.get(ship, Vehicle).moored).toBe(true);
    expect(continentOf(sim, trader)).toBe(terrain.componentOf(target));
  });

  it('refuses a trader on another continent', () => {
    const sim = newSim();
    const { trader, ship } = crossing(sim);
    sim.step();
    sim.world.mut(trader, Position).x = fx.fromInt(EAST_HOUSE_CELL);
    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: NORTH_WATER_Y });
    sim.step();

    expect(sim.world.has(ship, VehicleDrive)).toBe(false);
    expect(sim.world.get(ship, Vehicle).heldGoal).toBeNull();
    expect(refusalsOf(sim, ship)).toEqual(['noCommander']);
  });

  it('calls the held order off on a stop, and the trader goes back to its work', () => {
    const { sim, trader, ship, east } = ordered();
    order(sim, { kind: 'stopVehicle', vehicle: ship });
    sim.step();

    expect(sim.world.get(ship, Vehicle).heldGoal).toBeNull();
    expect(sim.world.has(trader, Rider)).toBe(false);

    runUntil(sim, LONG_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
    expectSound(sim);
  });

  it('lapses with the no-commander note when the trader dies on its way', () => {
    const { sim, trader, ship } = ordered();
    removeSettlerSilently(sim.world, trader);
    sim.step();

    expect(sim.world.get(ship, Vehicle).heldGoal).toBeNull();
    expect(refusalsOf(sim, ship)).toEqual(['noCommander']);
  });

  it('holds while the trader rounds onto the sea mid-step', () => {
    const { sim, trader, ship } = ordered();
    sim.world.mut(trader, Position).x = fx.fromInt(STRAIT_FROM);
    sim.step();

    expect(sim.world.get(ship, Vehicle).heldGoal).not.toBeNull();
    expect(refusalsOf(sim, ship)).toEqual([]);
  });
});

describe('a voyage that cannot dock', () => {
  it('lands the trader, tries again only after the cooldown, and sails once the shore opens', () => {
    const { sim, trader, east, blocker } = blockedVoyage();
    const failedAt: number[] = [];
    for (let elapsed = 0; elapsed < COOLDOWNS * TRADE_DOCK_RETRY_TICKS + VOYAGE_TICKS; elapsed++) {
      sim.step();
      if (refusalsOf(sim).includes('noPath')) failedAt.push(sim.tick);
      if (failedAt.length >= COOLDOWNS) break;
    }

    expect(failedAt).toHaveLength(COOLDOWNS);
    const [first = 0, second = 0] = failedAt;
    expect(second - first).toBeGreaterThanOrEqual(TRADE_DOCK_RETRY_TICKS);
    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(sim.world.has(trader, Position)).toBe(true);
    expectSound(sim);

    removeVehicle(sim.world, ctxOf(sim), blocker, 'script');
    runUntil(sim, COOLDOWNS * TRADE_DOCK_RETRY_TICKS + LONG_TICKS, () => stockOf(sim, east, WOOD) > 0);
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
  });
});

describe('the shipboard meal', () => {
  it('does not turn the trader into a cargo hand', () => {
    const { sim, trader, ship } = aboardMoored();
    const { content } = ctxOf(sim);
    stockVehicleGoods(sim.world, ship, content, FOOD, FOOD_ABOARD);
    consumeVehicleGood(sim.world, ship, content, FOOD);

    expect(cargoHandHasWork(sim.world, content, ship, trader)).toBe(false);
    expect(sim.world.get(ship, VehicleStock).lines.get(FOOD)).toMatchObject({
      current: FOOD_ABOARD - 1,
      wanted: FOOD_ABOARD - 1,
    });
  });
});

describe('the read seam', () => {
  it("says what a crossing route needs and keeps the ship's cargo apart", () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const trader = traderAt(sim, WEST_HOUSE_CELL);
    const ship = vehicleAt(sim, SHIP_SMALL, WEST_SHIP_X, SHIP_ROW);
    const across = vehicleAt(sim, SHIP_SMALL, EAST_SHIP_X, SHIP_ROW);
    stockVehicleGoods(sim.world, ship, ctxOf(sim).content, PLANK, SHIP_PLANKS);
    expect(sim.traderView(trader)?.shipState).toBe('notNeeded');

    attach(sim, trader, west);
    attach(sim, trader, east);
    sim.step();
    expect(sim.traderView(trader)?.shipState).toBe('needed');

    pin(sim, trader, ship);
    sim.step();
    const view = sim.traderView(trader);
    expect(view?.shipState).toBe('ready');
    expect(view?.ship).toEqual({ entity: ship, vehicleType: SHIP_SMALL });
    expect(view?.shipCargo).toEqual([{ good: PLANK, amount: SHIP_PLANKS }]);

    sim.world.mut(ship, Vehicle).mooring = sim.world.get(across, Vehicle).mooring;
    expect(sim.traderView(trader)?.shipState).toBe('unreachable');
  });

  it('keeps a hauling cart in the ship slot against the order, until it lands with its trader', () => {
    const { sim, trader, ship, cart } = aboardMoored();
    order(sim, { kind: 'leaveCarrier', vehicle: cart });
    sim.step();

    expect(sim.world.get(cart, Vehicle).carrier).toBe(ship);
    expect(
      sim.events.current().filter((ev) => ev.kind === 'vehicleCrewRefused' && ev.entity === cart),
    ).toMatchObject([{ reason: 'cannotLeave' }]);

    runUntil(sim, VOYAGE_TICKS, () => sim.world.has(trader, Position));
    expect(sim.world.has(trader, Position)).toBe(true);
    expect(sim.world.get(cart, Vehicle).carrier).toBeNull();
    expect(sim.world.get(trader, HaulingCart).vehicle).toBe(cart);
  });
});
