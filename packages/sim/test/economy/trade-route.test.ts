import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  goodsTradedWith,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  Stockpile,
  TradeRoute,
  Vehicle,
  VehicleStock,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  ONE,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { hexDistance } from '../../src/nav/halfcell.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-player/cadence.js';
import { interactionNode, vehicleAnchor } from '../../src/systems/footprint/index.js';
import {
  AI_STOCK_REFILL_LEVEL,
  AI_STOCK_REFILL_TURNS,
  TRADE_CART_HOUSE_DISTANCE,
} from '../../src/systems/trade/index.js';
import { createVehicle, VEHICLE_WALK_RANGE_NODES } from '../../src/systems/vehicles/index.js';
import { tradeVehicleStock } from '../../src/systems/vehicles/stock.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';

/**
 * The land trader plies a two-house route with the handcart it commands: it moves the cart to within
 * five steps of each house, between the player's own houses moves the surplus of one to the other in
 * the cart's hold, and at another player's house trades on the map's agreement, handing the give goods
 * over first and loading the take goods after, while the ledger counts what it brought back. A trader
 * without a cart stands idle, one whose cart cannot reach a stop lets go of it, and one the player sends
 * somewhere drives its cart there and resumes.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const OUTSIDER = 2;
const TRADER = 25;
const HANDCART = 1;
const WOOD = 1;
const PLANK = 2;
/** The fixture's edible, and the dish that becomes it once carried (`bread` -> `food_simple`). */
const FOOD = 3;
const BREAD = 7;
const HEADQUARTERS = 1;
/** The fixture's work temple, a house type that keeps no stock. */
const TEMPLE = 3;
const TRADING_POST_ID = 700;
const NEAR_X = 1;
const FAR_X = 7;
/** A third house between the two. */
const MIDDLE_X = 4;
const MAP_W = 10;
const MAP_H = 3;
/** Long enough for several round trips on the fixture's short map. */
const RUN_TICKS = 900;
/** Long enough for the trader to take command of its cart. */
const TRADE_START_TICKS = 60;
/** Planks put into the cart's hold by hand, which no house on the route marks. */
const STRAY_PLANKS = 2;
/** More wood than a handcart takes on one trip. */
const PLENTY_OF_WOOD = 30;
/** Long enough for a handcart's load of wood to be sold over several of the partner's refills. */
const SELL_OUT_TICKS = 4000;
/** Where the player sends the trader mid-stop: the row below the houses, between them. */
const ORDER_NODE = { hx: 8, hy: 4 } as const;

function houseAt(
  sim: Simulation,
  x: number,
  owner: number,
  stock: Array<[number, number]> = [],
  missionId?: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: owner });
  if (missionId !== undefined) sim.world.add(e, MissionObjectId, { id: missionId });
  return e;
}

/** A trader on foot at cell `x`, row 1. */
function traderOnFoot(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: TRADER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

/** A handcart standing at cell `x`, row 0, the trader's row being 1. */
function cartAt(sim: Simulation, x: number): Entity {
  const node = { hx: 2 * x, hy: 0 };
  const cart = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: HANDCART,
    x: node.hx,
    y: node.hy,
    tribe: VIKING,
    owner: HUMAN,
  });
  if (cart === null) throw new Error('handcart not in the fixture');
  return cart;
}

/** A trader at `x` that is ordered onto a handcart standing beside it, the commander seat being free. */
function traderAt(sim: Simulation, x: number): Entity {
  const trader = traderOnFoot(sim, x);
  const cart = cartAt(sim, x);
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  return trader;
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

/** The units of `good` aboard the trader's cart, 0 without one. */
function cartOf(sim: Simulation, trader: Entity, good: number): number {
  const vehicle = sim.world.tryGet(trader, Rider)?.vehicle;
  if (vehicle === undefined) return 0;
  return sim.world.get(vehicle, VehicleStock).lines.get(good)?.current ?? 0;
}

function cartDistanceTo(sim: Simulation, trader: Entity, house: Entity): number {
  const vehicle = sim.world.get(trader, Rider).vehicle;
  const anchor = vehicleAnchor(sim.world, vehicle);
  const door = interactionNode(sim.world, ctxOf(sim), house);
  if (anchor === null || door === null) throw new Error('cart or house off the map');
  return hexDistance(anchor, { hx: door.x, hy: door.y });
}

function newSim(): Simulation {
  const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(MAP_W, MAP_H) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

function attach(sim: Simulation, trader: Entity, house: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house }));
}

/** Mark `good` for import into `house`; after the attaches, which clear every mark. */
function mark(sim: Simulation, trader: Entity, house: Entity, good: number): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house, good, on: true }));
}

/** A route of `near` then `far` with wood marked for import into `far`. */
function woodRoute(sim: Simulation, trader: Entity, near: Entity, far: Entity): void {
  attach(sim, trader, near);
  attach(sim, trader, far);
  mark(sim, trader, far, WOOD);
}

/** The agreement the houses stamped {@link TRADING_POST_ID} offer: one wood for two planks. */
function offerWoodForPlanks(sim: Simulation): void {
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: TRADING_POST_ID,
    giveGood: WOOD,
    giveAmount: 1,
    takeGood: PLANK,
    takeAmount: 2,
  });
}

describe('a trader between its own houses', () => {
  it('carts a good marked at one house only over to it, however much it already holds', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 5]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 12]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(0);
    expect(stockOf(sim, far, WOOD)).toBe(17);
  });

  it('swaps two goods each house marks for itself', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[PLANK, 6]]);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);
    mark(sim, trader, far, WOOD);
    mark(sim, trader, near, PLANK);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBe(6);
    expect(stockOf(sim, near, PLANK)).toBe(6);
  });

  it('balances a good both houses mark, conserving every unit', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    mark(sim, trader, near, WOOD);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, near, WOOD)).toBeGreaterThanOrEqual(stockOf(sim, far, WOOD));
    expect(stockOf(sim, near, WOOD) + stockOf(sim, far, WOOD) + cartOf(sim, trader, WOOD)).toBe(10);
  });

  it('moves nothing and leaves the cart parked while no house carries a mark', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[PLANK, 10]]);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);
    sim.run(TRADE_START_TICKS);
    const cart = sim.world.get(trader, Rider).vehicle;
    const parked = vehicleAnchor(sim.world, cart);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(10);
    expect(stockOf(sim, far, PLANK)).toBe(10);
    expect(vehicleAnchor(sim.world, cart)).toEqual(parked);
  });

  it('keeps the cart parked once the marked good has all moved', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 3]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.run(RUN_TICKS);
    expect(stockOf(sim, far, WOOD)).toBe(3);
    const cart = sim.world.get(trader, Rider).vehicle;
    const parked = vehicleAnchor(sim.world, cart);

    sim.run(RUN_TICKS);

    expect(vehicleAnchor(sim.world, cart)).toEqual(parked);
  });

  it('unloads cargo no house marks at the first house that stores it', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, []);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.step();
    const cart = sim.world.get(trader, Rider).vehicle;
    tradeVehicleStock(sim.world, cart, sim.content, PLANK, STRAY_PLANKS);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, PLANK)).toBe(STRAY_PLANKS);
    expect(cartOf(sim, trader, PLANK)).toBe(0);
  });

  it('moves only the goods marked for import once any mark is set', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [
      [WOOD, 10],
      [PLANK, 10],
    ]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);
    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: far, good: PLANK, on: true }),
    );

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, PLANK)).toBeGreaterThan(0);
    expect(stockOf(sim, far, WOOD)).toBe(0);
    expect(stockOf(sim, near, WOOD)).toBe(10);
  });

  it('lets a third house take the first slot of a full route, marks cleared', () => {
    const sim = newSim();
    const first = houseAt(sim, NEAR_X, HUMAN);
    const second = houseAt(sim, FAR_X, HUMAN);
    const third = houseAt(sim, MIDDLE_X, HUMAN);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, first, second);
    attach(sim, trader, third);
    sim.step();

    const route = sim.world.get(trader, TradeRoute);
    expect(route.stops.map((stop) => stop.house)).toEqual([third, second]);
    expect(route.stops.every((stop) => stop.imports.length === 0)).toBe(true);
  });

  it('fills the first free slot, so a house detached from the first slot is replaced there', () => {
    const sim = newSim();
    const first = houseAt(sim, NEAR_X, HUMAN);
    const second = houseAt(sim, FAR_X, HUMAN);
    const third = houseAt(sim, MIDDLE_X, HUMAN);
    const trader = traderOnFoot(sim, NEAR_X);
    attach(sim, trader, first);
    attach(sim, trader, second);
    sim.step();
    sim.enqueue(playerCommand(HUMAN, { kind: 'detachTradeHouse', entity: trader, house: first }));
    sim.step();
    attach(sim, trader, third);
    sim.step();

    const route = sim.world.get(trader, TradeRoute);
    expect(route.stops.map((stop) => [stop.slot, stop.house])).toEqual([
      [0, third],
      [1, second],
    ]);
  });

  it('lets a foreign house take the first slot of a full route and drops the agreement it held', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    const other = houseAt(sim, MIDDLE_X, OUTSIDER, [], TRADING_POST_ID);
    const trader = traderOnFoot(sim, NEAR_X);
    offerWoodForPlanks(sim);
    attach(sim, trader, post);
    attach(sim, trader, own);
    sim.step();
    sim.world.mut(trader, TradeRoute).agreement = 0;
    attach(sim, trader, other);
    sim.step();

    const route = sim.world.get(trader, TradeRoute);
    expect(route.stops.map((stop) => stop.house)).toEqual([other, own]);
    expect(route.agreement).toBe(-1);
  });

  it('lets a second foreign house take the foreign stop, never a route of two foreign houses', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    const other = houseAt(sim, MIDDLE_X, OUTSIDER, [], TRADING_POST_ID);
    const trader = traderOnFoot(sim, NEAR_X);
    offerWoodForPlanks(sim);
    attach(sim, trader, own);
    attach(sim, trader, post);
    sim.step();
    sim.world.mut(trader, TradeRoute).agreement = 0;
    attach(sim, trader, other);
    sim.step();

    const route = sim.world.get(trader, TradeRoute);
    expect(route.stops.map((stop) => [stop.slot, stop.house])).toEqual([
      [0, own],
      [1, other],
    ]);
    expect(route.agreement).toBe(-1);
  });

  it('takes no foreign house that offers no agreement', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const stranger = houseAt(sim, FAR_X, NEIGHBOUR);
    const trader = traderOnFoot(sim, NEAR_X);
    attach(sim, trader, own);
    attach(sim, trader, stranger);
    sim.step();

    expect(sim.canAttachTradeHouse(trader, stranger)).toBe(false);
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([own]);
  });

  it('takes no own house that keeps no stock or is not finished', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const temple = houseAt(sim, MIDDLE_X, HUMAN);
    sim.world.mut(temple, Building).buildingType = TEMPLE;
    const site = houseAt(sim, FAR_X, HUMAN);
    sim.world.mut(site, Building).built = fx.fromInt(0);
    const trader = traderOnFoot(sim, NEAR_X);
    attach(sim, trader, own);
    attach(sim, trader, temple);
    attach(sim, trader, site);
    sim.step();

    expect(sim.canAttachTradeHouse(trader, temple)).toBe(false);
    expect(sim.canAttachTradeHouse(trader, site)).toBe(false);
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([own]);
  });

  it('keeps no import mark on a route with a foreign stop', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    const trader = traderOnFoot(sim, NEAR_X);
    offerWoodForPlanks(sim);
    attach(sim, trader, own);
    attach(sim, trader, post);
    sim.step();
    mark(sim, trader, own, WOOD);
    sim.step();

    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.imports)).toEqual([[], []]);
  });

  it('stands idle with a single house on its route', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(10);
    expect(sim.world.get(trader, TradeRoute).stops).toHaveLength(1);
  });

  it('stands idle on foot with a full route but no cart to command', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderOnFoot(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(10);
    expect(stockOf(sim, far, WOOD)).toBe(0);
    expect(sim.traderView(trader)?.cart).toBeNull();
    expect(sim.world.has(trader, Position)).toBe(true);
  });

  it('moves the cart to within five steps of each stop and rides inside between them', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    let rodeInside = false;
    let workedFar = false;
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      if (!sim.world.has(trader, Position)) rodeInside = true;
      if (sim.world.has(trader, Position) && cartDistanceTo(sim, trader, far) <= TRADE_CART_HOUSE_DISTANCE) {
        workedFar = true;
      }
    }

    expect(rodeInside).toBe(true);
    expect(workedFar).toBe(true);
    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
    const cart = sim.world.get(trader, Rider).vehicle;
    expect(sim.world.get(cart, Vehicle).heldGoal).toBeNull();
  });

  it('drives the cart to a stop beyond the goto walk range and works it', () => {
    const wide = 2 * VEHICLE_WALK_RANGE_NODES;
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(wide, MAP_H) });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, wide - 2, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(3 * RUN_TICKS);

    expect(sim.world.has(trader, Rider)).toBe(true);
    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
  });

  it('lets go of a cart that cannot be driven near the next stop', () => {
    // A water column cuts the far house off from the cart's landmass: no move point near it exists.
    const sim = new Simulation({
      seed: 3,
      content: testContent(),
      map: waterColumnMap(MAP_W, MAP_H, NEAR_X + 2),
    });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(RUN_TICKS);

    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(sim.world.has(trader, Position)).toBe(true);
    expect(sim.traderView(trader)?.cart).toBeNull();
    expect(stockOf(sim, far, WOOD)).toBe(0);
  });

  it("finishes the unit it is loading, drives the cart to the player's point with the load, then trades on", () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    const loading = (): boolean => sim.world.tryGet(trader, CurrentAtomic)?.effect?.kind === 'cartLoad';
    for (let tick = 0; tick < RUN_TICKS && !loading(); tick++) sim.step();
    expect(loading()).toBe(true);
    const cart = sim.world.get(trader, Rider).vehicle;
    const aboardBefore = cartOf(sim, trader, WOOD);

    sim.enqueue(
      playerCommand(HUMAN, { kind: 'moveUnit', entity: trader, x: ORDER_NODE.hx, y: ORDER_NODE.hy }),
    );
    sim.step();
    expect(loading()).toBe(true); // the unit in hand is finished first
    expect(sim.world.get(cart, Vehicle).heldGoal).toEqual(ORDER_NODE);
    expect(sim.world.has(trader, Rider)).toBe(true);

    let arrived = false;
    for (let tick = 0; tick < RUN_TICKS && !arrived; tick++) {
      sim.step();
      const anchor = vehicleAnchor(sim.world, cart);
      arrived = anchor !== null && anchor.hx === ORDER_NODE.hx && anchor.hy === ORDER_NODE.hy;
    }
    expect(arrived).toBe(true);
    expect(cartOf(sim, trader, WOOD)).toBe(aboardBefore + 1);
    expect(sim.world.has(trader, Rider)).toBe(true);

    sim.run(RUN_TICKS); // the route resumes from where the cart stands
    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, near, WOOD) + stockOf(sim, far, WOOD) + cartOf(sim, trader, WOOD)).toBe(10);
  });
});

describe('a trader at a foreign house', () => {
  function tradingWorld(stance: 'friend' | 'neutral'): {
    sim: Simulation;
    home: Entity;
    post: Entity;
    trader: Entity;
  } {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, 8]], TRADING_POST_ID);
    const trader = traderAt(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: stance });
    offerWoodForPlanks(sim);
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    return { sim, home, post, trader };
  }

  it('hands the give goods over, brings the take goods home and tallies them for the ledger', () => {
    const { sim, home, post, trader } = tradingWorld('friend');

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, home, PLANK)).toBeGreaterThan(0);
    const received = goodsTradedWith(sim.world, HUMAN, NEIGHBOUR);
    expect(received).toBeGreaterThanOrEqual(2);
    // Two planks per wood, and the ledger counts every plank the cart took aboard.
    expect(received).toBe(8 - stockOf(sim, post, PLANK));
    expect(stockOf(sim, home, PLANK) + cartOf(sim, trader, PLANK)).toBe(received);
    expect(sim.traderView(trader)?.agreementHolds).toBe(true);
    expect(goodsTradedWith(sim.world, NEIGHBOUR, HUMAN)).toBe(0);
  });

  it('answers a dish in the agreement with the edible its houses hold', () => {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, HUMAN, [[FOOD, 4]]);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, 8]], TRADING_POST_ID);
    const trader = traderAt(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: BREAD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

    sim.run(RUN_TICKS);

    // The cart carries the bread demand as `food_simple`, which the warehouse gives and the post takes.
    expect(stockOf(sim, post, FOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, home, PLANK)).toBeGreaterThan(0);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(2 * stockOf(sim, post, FOOD));
  });

  it('trades nothing while the partner is no friend', () => {
    const { sim, home, post } = tradingWorld('neutral');

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(0);
    expect(stockOf(sim, home, PLANK)).toBe(0);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(0);
  });

  it('carries its route, cart and tally through a save and back', () => {
    const { sim } = tradingWorld('friend');
    sim.run(RUN_TICKS / 3);

    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassMap(MAP_W, MAP_H),
    });
    sim.run(RUN_TICKS);
    restored.run(RUN_TICKS);

    expect(restored.hashState()).toBe(sim.hashState());
  });
});

describe('the houses a map agreement applies to', () => {
  function offersIn(match: readonly number[], aiSeats: readonly number[], owner: number): number {
    const sim = newSim();
    const post = houseAt(sim, FAR_X, owner, [], TRADING_POST_ID);
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: match });
    for (const player of aiSeats) sim.enqueueSetup({ kind: 'setPlayerAi', player, enabled: true });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    sim.run(1);
    return sim.tradeOffersAt(post).length;
  }

  it("offers at a computer seat's house, in the match or not", () => {
    expect(offersIn([HUMAN, NEIGHBOUR], [NEIGHBOUR], NEIGHBOUR)).toBe(1);
    expect(offersIn([HUMAN, NEIGHBOUR], [], OUTSIDER)).toBe(1);
  });

  it("offers nothing at a human player's house", () => {
    expect(offersIn([HUMAN, NEIGHBOUR], [], NEIGHBOUR)).toBe(0);
  });

  it("lists a partner's agreements once each, however many of its houses carry the row", () => {
    const sim = newSim();
    houseAt(sim, NEAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    for (const takeAmount of [2, 3]) {
      sim.enqueueSetup({
        kind: 'addTradeAgreement',
        missionId: TRADING_POST_ID,
        giveGood: WOOD,
        giveAmount: 1,
        takeGood: PLANK,
        takeAmount,
      });
    }
    sim.run(1);

    expect(sim.tradeOffersOf(NEIGHBOUR).map((offer) => [offer.index, offer.takeAmount])).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(sim.tradeOffersOf(OUTSIDER)).toEqual([]);
  });

  it('gates nothing in a world that set no match up', () => {
    expect(offersIn([], [], NEIGHBOUR)).toBe(1);
  });
});

describe("a computer seat's trade house", () => {
  const SAWMILL = 2;
  /** The seat's turn inside a handler round: seat `p` moves on tick `3p` of it. */
  const NEIGHBOUR_TURN_OFFSET = 3 * NEIGHBOUR;
  const tickOfTurn = (turn: number): number => turn * AI_HANDLER_ROUND_TICKS + NEIGHBOUR_TURN_OFFSET;

  function partnerWorld(
    ai: { scripted: boolean } | null,
    stock: Array<[number, number]> = [],
    buildingType = HEADQUARTERS,
  ): { sim: Simulation; post: Entity } {
    const sim = newSim();
    const post = houseAt(sim, FAR_X, NEIGHBOUR, stock, TRADING_POST_ID);
    sim.world.mut(post, Building).buildingType = buildingType;
    if (ai !== null) {
      sim.enqueueSetup({ kind: 'setPlayerAi', player: NEIGHBOUR, enabled: true, scripted: ai.scripted });
    }
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    return { sim, post };
  }

  it('has the good it pays out refilled on every sixth handler turn, from the first', () => {
    const { sim, post } = partnerWorld({ scripted: true });

    sim.run(tickOfTurn(0) + 1);
    expect(stockOf(sim, post, PLANK)).toBe(AI_STOCK_REFILL_LEVEL);

    sim.world.mut(post, Stockpile).amounts.set(PLANK, 0);
    sim.run(tickOfTurn(AI_STOCK_REFILL_TURNS - 1) + 1 - sim.tick);
    expect(stockOf(sim, post, PLANK)).toBe(0);

    sim.run(tickOfTurn(AI_STOCK_REFILL_TURNS) + 1 - sim.tick);
    expect(stockOf(sim, post, PLANK)).toBe(AI_STOCK_REFILL_LEVEL);
  });

  it('leaves a fuller shelf and every other good as they are', () => {
    const { sim, post } = partnerWorld({ scripted: true }, [
      [PLANK, 9],
      [WOOD, 2],
    ]);

    sim.run(tickOfTurn(0) + 1);

    expect(stockOf(sim, post, PLANK)).toBe(9);
    expect(stockOf(sim, post, WOOD)).toBe(2);
  });

  it('stays empty for a seat the map switched off, a human seat, and a house that is no warehouse', () => {
    const worlds = [
      partnerWorld({ scripted: false }),
      partnerWorld(null),
      partnerWorld({ scripted: true }, [], SAWMILL),
    ];
    for (const { sim, post } of worlds) {
      sim.run(tickOfTurn(0) + 1);

      expect(stockOf(sim, post, PLANK)).toBe(0);
    }
  });

  it('keeps a trader at the house through the refills until its whole load is sold', () => {
    const { sim, post } = partnerWorld({ scripted: true });
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, PLENTY_OF_WOOD]]);
    const trader = traderAt(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

    let loaded = 0;
    while (stockOf(sim, home, PLANK) === 0 && sim.tick < SELL_OUT_TICKS) {
      sim.run(1);
      loaded = Math.max(loaded, cartOf(sim, trader, WOOD));
    }

    // More wood than one refill pays for went out, and all of it was sold before the planks came home.
    expect(loaded * 2).toBeGreaterThan(AI_STOCK_REFILL_LEVEL);
    expect(stockOf(sim, home, PLANK)).toBeGreaterThan(0);
    expect(stockOf(sim, post, WOOD)).toBe(loaded);
  });

  it('pays a trader out of a house the map authored empty', () => {
    const { sim, post } = partnerWorld({ scripted: true });
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
    const trader = traderAt(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

    sim.run(RUN_TICKS);

    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBeGreaterThanOrEqual(2);
    expect(stockOf(sim, home, PLANK) + cartOf(sim, trader, PLANK)).toBeGreaterThan(0);
  });
});
