import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  goodsTradedWith,
  MissionObjectId,
  Owner,
  Position,
  Stockpile,
  TradeRoute,
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
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The land trader plies a two-house route with its cart: between the player's own houses it moves the
 * surplus of one to the other; at another player's house it trades on the map's agreement, handing the
 * give goods over first and loading the take goods after, and the ledger counts what it brought back.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const TRADER = 25;
const WOOD = 1;
const PLANK = 2;
/** The fixture's edible, and the dish that becomes it once carried (`bread` -> `food_simple`). */
const FOOD = 3;
const BREAD = 7;
const HEADQUARTERS = 1;
const TRADING_POST_ID = 700;
const NEAR_X = 1;
const FAR_X = 7;
const MAP_W = 10;
const MAP_H = 3;
/** Long enough for several round trips on the fixture's short map. */
const RUN_TICKS = 900;

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

function traderAt(sim: Simulation, x: number): Entity {
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

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

function cartOf(sim: Simulation, trader: Entity, good: number): number {
  return sim.world.tryGet(trader, TradeRoute)?.cargo.get(good) ?? 0;
}

function newSim(): Simulation {
  const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(MAP_W, MAP_H) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

function attach(sim: Simulation, trader: Entity, house: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house }));
}

describe('a trader between its own houses', () => {
  it('carts the surplus of one house over to the other, conserving every unit', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, near, WOOD)).toBeLessThan(10);
    expect(stockOf(sim, near, WOOD) + stockOf(sim, far, WOOD) + cartOf(sim, trader, WOOD)).toBe(10);
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
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
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
