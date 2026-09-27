import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  IdleStand,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  Stockpile,
  setStockAmount,
  VehicleDrive,
  VehicleStock,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, playerCommand, Simulation } from '../../src/index.js';
import { roomFor } from '../../src/systems/missions/stock.js';
import { IDLE_REPLAN_PERIOD_TICKS } from '../../src/systems/settlers/planner/idle-replan.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { societyContent } from '../fixtures/content/societies.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * A trader with nothing it can move waits: parked by its cart's door it stands on the idle cadence instead
 * of running its ladder every tick, and a route command wakes it on the tick it applies; at a foreign
 * house whose take good its cart cannot carry it hands nothing over, and at one with no room for the give
 * good it keeps the cart parked there until room appears.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const PLANK = 2;
const TRADING_POST_ID = 700;
/** Long enough for several trips to the post and back. */
const RUN_TICKS = 900;
const TRADER = 25;
const HANDCART = 1;
const WOOD = 1;
const HEADQUARTERS = 1;
const NEAR_X = 1;
const FAR_X = 7;
const MAP_W = 10;
const MAP_H = 3;
/** Long enough for the trader to take command of its cart and walk to its door. */
const SETTLE_TICKS = 60;
/** Long enough for a woken trader to put a unit in the hold. */
const LOAD_TICKS = 300;
/** The trading post's wood once room is made on its full shelf. */
const POST_WOOD_DRAWN_DOWN = 10;

/** How many times the cart set off over `ticks` ticks. */
function cartDrives(sim: Simulation, cart: Entity, ticks: number): number {
  let drives = 0;
  let driving = sim.world.has(cart, VehicleDrive);
  for (let t = 0; t < ticks; t++) {
    sim.step();
    const now = sim.world.has(cart, VehicleDrive);
    if (now && !driving) drives++;
    driving = now;
  }
  return drives;
}

function newSim(content = testContent()): Simulation {
  const sim = new Simulation({ seed: 3, content, map: grassCellMap(MAP_W, MAP_H) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

/** The fixture content with a handcart that carries wood and food but no planks. */
function plankLessCartContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
    vehicles: economyContent.vehicles.map((type) =>
      type.typeId === HANDCART ? { ...type, cargoGoods: type.cargoGoods?.filter((g) => g !== PLANK) } : type,
    ),
  });
}

function houseAt(
  sim: Simulation,
  x: number,
  stock: Array<[number, number]>,
  owner = HUMAN,
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

/** A trader at cell `x`, row 1, ordered onto a handcart standing on row 0 beside it. */
function traderWithCart(sim: Simulation, x: number): { trader: Entity; cart: Entity } {
  const trader = sim.world.create();
  sim.world.add(trader, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  addPerson(sim.world, trader, {
    tribe: VIKING,
    jobType: TRADER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(trader, Owner, { player: HUMAN });
  const cart = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: HANDCART,
    x: 2 * x,
    y: 0,
    tribe: VIKING,
    owner: HUMAN,
  });
  if (cart === null) throw new Error('handcart not in the fixture');
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  return { trader, cart };
}

/** Whether `trader` stood idle on every one of the next `ticks` ticks. */
function idleThroughout(sim: Simulation, trader: Entity, ticks: number): boolean {
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (!sim.world.has(trader, IdleStand)) return false;
  }
  return true;
}

describe('a trader with nothing to move', () => {
  it('stands idle by the door of a cart it has no route for', () => {
    const sim = newSim();
    const { trader } = traderWithCart(sim, NEAR_X);
    sim.run(SETTLE_TICKS);
    expect(sim.world.has(trader, Rider)).toBe(true);
    expect(sim.world.has(trader, Position)).toBe(true);
    expect(idleThroughout(sim, trader, 2 * IDLE_REPLAN_PERIOD_TICKS)).toBe(true);
  });

  it('stands idle on an unmarked route between its own houses, and a mark wakes it into work', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, [[WOOD, 5]]);
    const far = houseAt(sim, FAR_X, []);
    const { trader, cart } = traderWithCart(sim, NEAR_X);
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: near }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: far }));
    sim.run(SETTLE_TICKS);
    expect(idleThroughout(sim, trader, 2 * IDLE_REPLAN_PERIOD_TICKS)).toBe(true);

    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: far, good: WOOD, on: true }),
    );
    sim.step();
    expect(sim.world.has(trader, IdleStand)).toBe(false);
    let loaded = 0;
    for (let t = 0; t < LOAD_TICKS && loaded === 0; t++) {
      sim.step();
      loaded = sim.world.get(cart, VehicleStock).lines.get(WOOD)?.current ?? 0;
    }
    expect(loaded).toBeGreaterThan(0);
  });
});

describe('a trader at a foreign house its cart cannot take from', () => {
  it('hands no give good over for a take good the hold cannot carry, and waits with its load', () => {
    const sim = newSim(plankLessCartContent());
    const home = houseAt(sim, NEAR_X, [[WOOD, 6]]);
    const post = houseAt(sim, FAR_X, [[PLANK, 8]], NEIGHBOUR, TRADING_POST_ID);
    const { trader, cart } = traderWithCart(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: home }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: post }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

    sim.run(RUN_TICKS);

    expect(sim.world.get(cart, VehicleStock).lines.get(WOOD)?.current ?? 0).toBeGreaterThan(0);
    expect(sim.world.get(post, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.get(post, Stockpile).amounts.get(PLANK)).toBe(8);
  });
});

describe('a trader at a foreign house with no room for the give good', () => {
  it('keeps the cart parked at the house with its load until room appears, then hands over', () => {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, [[WOOD, 6]]);
    const post = houseAt(sim, FAR_X, [[PLANK, 8]], NEIGHBOUR, TRADING_POST_ID);
    const { trader, cart } = traderWithCart(sim, NEAR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: home }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: post }));
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    sim.step();
    setStockAmount(sim.world, post, WOOD, roomFor(sim.world, ctxOf(sim), post, WOOD));
    const full = sim.world.get(post, Stockpile).amounts.get(WOOD);

    // One trip out with the wood, and none after it while the shelf stays full.
    expect(cartDrives(sim, cart, RUN_TICKS)).toBe(1);
    expect(cartDrives(sim, cart, RUN_TICKS)).toBe(0);
    expect(sim.world.get(cart, VehicleStock).lines.get(WOOD)?.current).toBe(6);
    expect(sim.world.get(post, Stockpile).amounts.get(WOOD)).toBe(full);

    setStockAmount(sim.world, post, WOOD, POST_WOOD_DRAWN_DOWN);
    sim.run(RUN_TICKS);
    expect(sim.world.get(post, Stockpile).amounts.get(WOOD)).toBeGreaterThan(POST_WOOD_DRAWN_DOWN);
  });
});
