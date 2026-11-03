import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CARRY_CAPACITY,
  Carrying,
  CurrentAtomic,
  goodsTradedWith,
  HaulingCart,
  MissionObjectId,
  Owner,
  PathRequest,
  Position,
  Rider,
  Stockpile,
  setStockAmount,
  stampOwner,
  TRADE_LIMIT_NONE,
  TradeRoute,
  UnderConstruction,
  VehicleStock,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  adminCommand,
  exportSaveGame,
  fx,
  ONE,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { hexDistance, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { AI_HANDLER_ROUND_TICKS } from '../../../src/systems/ai-shared/cadence.js';
import { interactionNode, vehicleAnchor } from '../../../src/systems/footprint/index.js';
import { DOOR_HEAP_RADIUS_NODES } from '../../../src/systems/settlers/drives/economy/workshop/door-heap.js';
import { interactionCell } from '../../../src/systems/settlers/targets/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../src/systems/spatial/metric.js';
import { isLoosePile, MAX_GROUND_STACK } from '../../../src/systems/stores/index.js';
import {
  AI_STOCK_REFILL_LEVEL,
  AI_STOCK_REFILL_TURNS,
  TRADE_CART_HOUSE_DISTANCE,
} from '../../../src/systems/trade/index.js';
import { attachToVehicle, boardRider } from '../../../src/systems/vehicles/crew.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { tradeVehicleStock } from '../../../src/systems/vehicles/stock.js';
import { economyContent } from '../../fixtures/content/economy.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../../fixtures/terrain.js';

/**
 * The land trader plies a two-house route on foot, a unit in its hands a trip, or with the handcart it
 * pulls as its tool, standing the cart within five steps of each house it works: between the player's
 * own houses it moves the surplus of one to the other, and at another player's house it trades on the
 * map's agreement, handing the give goods over first and loading the take goods after, while the ledger
 * counts what it brought back. One the player sends somewhere walks there and resumes.
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
/** The fixture's bakery, the one house that keeps bread. */
const KITCHEN = 21;
const LOAVES = 5;
/** Below the loaves, so the ceiling, not the stock, ends the run. */
const FOOD_CEILING = 3;
const HEADQUARTERS = 1;
/** The headquarters' next level, in {@link upgradableHeadquartersContent}. */
const HEADQUARTERS_L1 = 90;
/** The fixture's work temple, a house type that keeps no stock. */
const TEMPLE = 3;
const TRADING_POST_ID = 700;
/** A mission id no house on the map carries. */
const OTHER_POST_ID = 701;
const NEAR_X = 1;
const FAR_X = 7;
/** A third house between the two. */
const MIDDLE_X = 4;
const MAP_W = 10;
const MAP_H = 3;
/** A map 240 nodes wide, four times the original's 60-node vehicle walk range. */
const WIDE_MAP_CELLS = 120;
/** Long enough for several round trips on the fixture's short map. */
const RUN_TICKS = 900;
/** The wide-map drive with ten wood in a handcart of fifteen: a two-thirds load costs the cart a third
 *  of its speed (`drag.ts`), so the run takes half as long again as an empty one. */
const LADEN_WIDE_RUN_TICKS = 5 * RUN_TICKS;
/** More wood than a handcart's hold of fifteen takes on one trip, as one exchange's give. */
const CART_OVERSIZED_GIVE = 20;
/** Long enough for a trader on foot to carry a few exchanges by hand. */
const SHUTTLE_TICKS = 3 * RUN_TICKS;
/** Long enough for the trader to take up its cart. */
const TRADE_START_TICKS = 60;
/** Planks put into the cart's hold by hand, which no house on the route marks. */
const STRAY_PLANKS = 2;
/** More wood than a handcart takes on one trip. */
const PLENTY_OF_WOOD = 30;
/** Long enough for a handcart's load of wood to be sold over several of the partner's refills. */
const SELL_OUT_TICKS = 4000;
/** Where the player sends the trader mid-stop: the row below the houses, between them. */
const ORDER_NODE = { hx: 8, hy: 4 } as const;
/** The wood a mark's ceiling fills the far house up to, below what the near house holds. */
const WOOD_CEILING = 5;
/** The far house's wood once the player takes some out below the ceiling. */
const WOOD_DRAWN_DOWN = 2;
/** The wood a mark leaves in the near house. */
const WOOD_KEPT = 4;
/** The wood a headquarters stores, by the fixture. */
const HEADQUARTERS_WOOD_ROOM = 150;
/** More wood than two ground stacks hold, so the heap spreads over a third tile. */
const WOOD_SENT = 3 * MAX_GROUND_STACK;
/** Planks a trading post holds: more than three ground stacks, a whole number of two-plank batches. */
const PARTNER_PLANKS = 16;

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

/** A trader at `x` handed a handcart standing beside it, to pull as its tool. */
function traderAt(sim: Simulation, x: number): Entity {
  const trader = traderOnFoot(sim, x);
  const cart = cartAt(sim, x);
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  return trader;
}

/** The units of `good` lying on the ground. */
function groundUnits(sim: Simulation, good: number): number {
  let units = 0;
  for (const e of sim.world.query(Stockpile))
    if (isLoosePile(sim.world, e)) units += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  return units;
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

/** The trader's hauling cart; throws for a trader on foot. */
function cartOfTrader(sim: Simulation, trader: Entity): Entity {
  return sim.world.get(trader, HaulingCart).vehicle;
}

/** The units of `good` in the trader's hold: its hauling cart's, else its hands. */
function holdOf(sim: Simulation, trader: Entity, good: number): number {
  const vehicle = sim.world.tryGet(trader, HaulingCart)?.vehicle;
  if (vehicle === undefined) {
    const held = sim.world.tryGet(trader, Carrying);
    return held?.goodType === good ? held.amount : 0;
  }
  return sim.world.get(vehicle, VehicleStock).lines.get(good)?.current ?? 0;
}

function cartDistanceTo(sim: Simulation, trader: Entity, house: Entity): number {
  const anchor = vehicleAnchor(sim.world, cartOfTrader(sim, trader));
  const door = interactionNode(sim.world, ctxOf(sim), house);
  if (anchor === null || door === null) throw new Error('cart or house off the map');
  return hexDistance(anchor, { hx: door.x, hy: door.y });
}

function newSim(content = testContent()): Simulation {
  const sim = new Simulation({ seed: 3, content, map: grassMap(MAP_W, MAP_H) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

/** The fixture content with a next level of the headquarters to upgrade into. */
function upgradableHeadquartersContent(): ContentSet {
  const content = testContent();
  const headquarters = economyContent.buildings.find((type) => type.typeId === HEADQUARTERS);
  if (headquarters === undefined) throw new Error('headquarters not in the fixture');
  return parseContentSet({
    ...content,
    manifest: TEST_MANIFEST,
    buildings: [
      ...content.buildings.map((type) =>
        type.typeId === HEADQUARTERS ? { ...type, upgradeTarget: HEADQUARTERS_L1 } : type,
      ),
      {
        ...headquarters,
        typeId: HEADQUARTERS_L1,
        id: 'headquarters_01',
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

/** Friendship both ways between the trader's player and `other`, which a foreign stop needs to join. */
function befriend(sim: Simulation, other: number): void {
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: other, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: other, to: HUMAN, state: 'friend' });
}

function attach(sim: Simulation, trader: Entity, house: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house }));
}

/** Mark `good` for import into `house`; after the attaches, which clear every mark. */
function mark(sim: Simulation, trader: Entity, house: Entity, good: number): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house, good, on: true }));
}

/** Set the limits of the mark on `good` at `house`, in units. */
function limit(
  sim: Simulation,
  trader: Entity,
  house: Entity,
  good: number,
  upTo: number,
  keep: number,
): void {
  sim.enqueue(
    playerCommand(HUMAN, { kind: 'setTradeImportLimits', entity: trader, house, good, upTo, keep }),
  );
}

/** A route of `near` then `far` with wood marked for import into `far`. */
function woodRoute(sim: Simulation, trader: Entity, near: Entity, far: Entity): void {
  attach(sim, trader, near);
  attach(sim, trader, far);
  mark(sim, trader, far, WOOD);
}

/** The agreement the houses stamped {@link TRADING_POST_ID} offer: `wood` for `planks`, one for two
 *  unless given. */
function offerWoodForPlanks(sim: Simulation, wood = 1, planks = 2): void {
  sim.enqueueSetup({
    kind: 'addTradeAgreement',
    missionId: TRADING_POST_ID,
    giveGood: WOOD,
    giveAmount: wood,
    takeGood: PLANK,
    takeAmount: planks,
  });
}

/** A route from a home whose plank shelf is full to the trading post, trading on its one agreement. */
function fullHomeTrade(onFoot: boolean) {
  const sim = newSim();
  befriend(sim, NEIGHBOUR);
  offerWoodForPlanks(sim);
  const home = houseAt(sim, NEAR_X, HUMAN, [
    [WOOD, PLENTY_OF_WOOD],
    [PLANK, HEADQUARTERS_WOOD_ROOM],
  ]);
  const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, PARTNER_PLANKS]], TRADING_POST_ID);
  const trader = onFoot ? traderOnFoot(sim, NEAR_X) : traderAt(sim, NEAR_X);
  attach(sim, trader, home);
  attach(sim, trader, post);
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
  return { sim, home, post };
}

/** Cover every tile within the door heap's reach of `house` with a unit of another good. */
function coverDoorGround(sim: Simulation, house: Entity): void {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  const door = interactionCell(sim.world, ctx, terrain, house);
  const { x, y } = terrain.coordsOf(door);
  for (let ring = 0; ring <= DOOR_HEAP_RADIUS_NODES; ring++) {
    for (let i = 0; i < ringOffsetCount(ring); i++) {
      const pile = sim.world.create();
      sim.world.add(pile, Position, positionOfNode(x + ringOffsetDx(ring, i), y + ringOffsetDy(ring, i)));
      sim.world.add(pile, Stockpile, { amounts: new Map([[FOOD, 1]]) });
    }
  }
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

  it('sets a good marked for a full house down on the ground by its door', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, WOOD_SENT]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, HEADQUARTERS_WOOD_ROOM]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(0);
    expect(stockOf(sim, far, WOOD)).toBe(HEADQUARTERS_WOOD_ROOM);
    expect(groundUnits(sim, WOOD)).toBe(WOOD_SENT);
  });

  it('sets a good marked for a full house down on the ground by its door on foot as well', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, WOOD_SENT]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, HEADQUARTERS_WOOD_ROOM]]);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(2 * SHUTTLE_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(0);
    expect(holdOf(sim, trader, WOOD)).toBe(0);
    expect(groundUnits(sim, WOOD)).toBe(WOOD_SENT);
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
    expect(stockOf(sim, near, WOOD) + stockOf(sim, far, WOOD) + holdOf(sim, trader, WOOD)).toBe(10);
  });

  it('moves nothing and leaves the cart parked while no house carries a mark', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[PLANK, 10]]);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);
    sim.run(TRADE_START_TICKS);
    const cart = cartOfTrader(sim, trader);
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
    const cart = cartOfTrader(sim, trader);
    const parked = vehicleAnchor(sim.world, cart);

    sim.run(RUN_TICKS);

    expect(vehicleAnchor(sim.world, cart)).toEqual(parked);
  });

  it('keeps a house on its route through an upgrade and trades on once it stands again', () => {
    const sim = newSim(upgradableHeadquartersContent());
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.enqueue(playerCommand(HUMAN, { kind: 'upgradeBuilding', building: far }));
    sim.step();
    expect(sim.world.has(far, UnderConstruction)).toBe(true);

    sim.run(RUN_TICKS);

    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([near, far]);
    expect(stockOf(sim, near, WOOD) + holdOf(sim, trader, WOOD)).toBe(10);

    sim.enqueue(playerCommand(HUMAN, { kind: 'cancelUpgrade', building: far }));
    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBe(10);
  });

  it('drops a house that falls from its route', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.run(TRADE_START_TICKS);

    sim.world.destroy(far);
    sim.run(TRADE_START_TICKS);

    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([near]);
  });

  it('carts bread marked into a house that keeps only food, as food and up to the ceiling', () => {
    const sim = newSim();
    const kitchen = houseAt(sim, NEAR_X, HUMAN);
    sim.world.mut(kitchen, Building).buildingType = KITCHEN;
    setStockAmount(sim.world, kitchen, BREAD, LOAVES);
    const far = houseAt(sim, FAR_X, HUMAN);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, kitchen);
    attach(sim, trader, far);
    mark(sim, trader, far, BREAD);
    limit(sim, trader, far, BREAD, FOOD_CEILING, TRADE_LIMIT_NONE);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, FOOD)).toBe(FOOD_CEILING);
    expect(stockOf(sim, kitchen, BREAD)).toBe(LOAVES - FOOD_CEILING);
    expect(holdOf(sim, trader, FOOD)).toBe(0);
  });

  it('unloads cargo no house marks at the first house that stores it', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, []);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.step();
    const cart = cartOfTrader(sim, trader);
    tradeVehicleStock(sim.world, cart, sim.content, PLANK, STRAY_PLANKS);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, PLANK)).toBe(STRAY_PLANKS);
    expect(holdOf(sim, trader, PLANK)).toBe(0);
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

  it("fills a house only up to its mark's ceiling and tops it up again once the stock drops", () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, PLENTY_OF_WOOD]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    limit(sim, trader, far, WOOD, WOOD_CEILING, TRADE_LIMIT_NONE);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBe(WOOD_CEILING);
    expect(holdOf(sim, trader, WOOD)).toBe(0);
    expect(stockOf(sim, near, WOOD)).toBe(PLENTY_OF_WOOD - WOOD_CEILING);

    setStockAmount(sim.world, far, WOOD, WOOD_DRAWN_DOWN);
    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBe(WOOD_CEILING);
    expect(stockOf(sim, near, WOOD)).toBe(PLENTY_OF_WOOD - 2 * WOOD_CEILING + WOOD_DRAWN_DOWN);
  });

  it('leaves the reserve a mark keeps in the house it loads from', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, PLENTY_OF_WOOD]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    limit(sim, trader, far, WOOD, TRADE_LIMIT_NONE, WOOD_KEPT);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, far, WOOD)).toBe(PLENTY_OF_WOOD - WOOD_KEPT);
  });

  it('balances a good both houses mark no further than the ceiling of the house it flows into', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, PLENTY_OF_WOOD]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    mark(sim, trader, near, WOOD);
    limit(sim, trader, far, WOOD, WOOD_CEILING, TRADE_LIMIT_NONE);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, far, WOOD)).toBe(WOOD_CEILING);
    expect(stockOf(sim, near, WOOD) + holdOf(sim, trader, WOOD)).toBe(PLENTY_OF_WOOD - WOOD_CEILING);
  });

  it('sets the limits of an existing mark only, and shows them on the trader view', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN);
    const far = houseAt(sim, FAR_X, HUMAN);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    limit(sim, trader, far, WOOD, WOOD_CEILING, WOOD_KEPT);
    limit(sim, trader, far, PLANK, WOOD_CEILING, WOOD_KEPT);
    limit(sim, trader, near, WOOD, WOOD_CEILING, WOOD_KEPT);
    sim.step();

    const expected = [[], [{ good: WOOD, upTo: WOOD_CEILING, keep: WOOD_KEPT }]];
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.imports)).toEqual(expected);
    expect(sim.traderView(trader)?.stops.map((stop) => stop.imports)).toEqual(expected);
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
    befriend(sim, NEIGHBOUR);
    befriend(sim, OUTSIDER);
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
    befriend(sim, NEIGHBOUR);
    befriend(sim, OUTSIDER);
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

  it('takes a foreign house only while both players hold friend toward each other', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    const trader = traderOnFoot(sim, NEAR_X);
    offerWoodForPlanks(sim);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'enemy' });
    attach(sim, trader, own);
    attach(sim, trader, post);
    sim.step();

    expect(sim.canAttachTradeHouse(trader, post)).toBe(false);
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([own]);
    sim.enqueue(adminCommand({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'friend' }));
    sim.step();
    expect(sim.canAttachTradeHouse(trader, post)).toBe(true);
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
    // The batched read lists what the rule admits: the route already holds `own`, so nothing is left.
    expect(sim.tradeHousesAttachableBy(trader)).toEqual(
      [own, temple, site].filter((house) => sim.canAttachTradeHouse(trader, house)),
    );
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.house)).toEqual([own]);
  });

  it('keeps no import mark on a route with a foreign stop', () => {
    const sim = newSim();
    const own = houseAt(sim, NEAR_X, HUMAN);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [], TRADING_POST_ID);
    const trader = traderOnFoot(sim, NEAR_X);
    offerWoodForPlanks(sim);
    befriend(sim, NEIGHBOUR);
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

  it('carries the goods by hand without a cart, a unit a trip', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    let most = 0;
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      most = Math.max(most, holdOf(sim, trader, WOOD));
    }

    expect(most).toBe(CARRY_CAPACITY);
    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(1);
    expect(stockOf(sim, near, WOOD) + stockOf(sim, far, WOOD) + holdOf(sim, trader, WOOD)).toBe(10);
    expect(sim.traderView(trader)?.cart).toBeNull();
  });

  it('lifts a unit into its handcart faster than into its hands', () => {
    const liftTicks = (place: (sim: Simulation, x: number) => Entity): Set<number> => {
      const sim = newSim();
      const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
      const far = houseAt(sim, FAR_X, HUMAN, []);
      const trader = place(sim, NEAR_X);
      woodRoute(sim, trader, near, far);
      const seen = new Set<number>();
      for (let tick = 0; tick < RUN_TICKS; tick++) {
        sim.step();
        const atomic = sim.world.tryGet(trader, CurrentAtomic);
        const kind = atomic?.effect.kind;
        if (atomic !== undefined && (kind === 'tradeLoad' || kind === 'tradeUnload'))
          seen.add(atomic.duration);
      }
      return seen;
    };
    const byHand = [...liftTicks(traderOnFoot)];
    const byCart = [...liftTicks(traderAt)];
    expect(byHand.length).toBeGreaterThan(0);
    expect(byCart.length).toBeGreaterThan(0);
    expect(Math.max(...byCart)).toBeLessThan(Math.min(...byHand));
  });

  it('pulls its cart between the stops and stands it within five steps of the house it works', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    let pulled = false;
    let workedAway = false;
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      if (sim.world.tryGet(trader, HaulingCart)?.taken === true) pulled = true;
      const work = sim.world.tryGet(trader, CurrentAtomic)?.effect;
      const house = work?.kind === 'tradeLoad' ? work.from : work?.kind === 'tradeUnload' ? work.store : null;
      if (house !== null && cartDistanceTo(sim, trader, house) > TRADE_CART_HOUSE_DISTANCE) workedAway = true;
    }

    expect(pulled).toBe(true);
    expect(workedAway).toBe(false);
    expect(stockOf(sim, far, WOOD)).toBe(10);
    expect(sim.world.has(trader, Rider)).toBe(false);
  });

  it('pulls the cart to a stop past the original vehicle walk range and works it', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(WIDE_MAP_CELLS, MAP_H) });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, WIDE_MAP_CELLS - 2, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    sim.run(LADEN_WIDE_RUN_TICKS);

    expect(sim.world.has(trader, HaulingCart)).toBe(true);
    expect(stockOf(sim, far, WOOD)).toBeGreaterThan(0);
  });

  it.each([
    { name: 'before', seatFirst: true },
    { name: 'after', seatFirst: false },
  ])(
    'steps out of the cart a script seated it in $name its route, and pulls that cart instead',
    ({ seatFirst }) => {
      const sim = newSim();
      const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
      const far = houseAt(sim, FAR_X, HUMAN, []);
      const trader = traderOnFoot(sim, NEAR_X);
      const cart = cartAt(sim, NEAR_X);
      // As `SetVehicle` seats a cart's captain.
      const seat = (): void => {
        attachToVehicle(sim.world, ctxOf(sim), { kind: 'attachToVehicle', entity: trader, vehicle: cart });
        boardRider(sim.world, trader, cart);
      };
      if (seatFirst) seat();
      woodRoute(sim, trader, near, far);
      sim.step();
      if (!seatFirst) seat();

      sim.run(RUN_TICKS);

      expect(sim.world.has(trader, Rider)).toBe(false);
      expect(sim.world.get(trader, HaulingCart).vehicle).toBe(cart);
      expect(stockOf(sim, far, WOOD)).toBe(10);
    },
  );

  it('puts a unit it carries by hand into a cart it is handed, as it takes the cart up', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    for (let tick = 0; tick < RUN_TICKS && !sim.world.has(trader, Carrying); tick++) sim.step();
    expect(sim.world.get(trader, Carrying).goodType).toBe(WOOD);
    const cart = cartAt(sim, NEAR_X);

    sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
    for (let tick = 0; tick < RUN_TICKS && sim.world.tryGet(trader, HaulingCart)?.taken !== true; tick++) {
      sim.step();
    }

    expect(sim.world.has(trader, Carrying)).toBe(false);
    expect(holdOf(sim, trader, WOOD)).toBe(1);
  });

  it('never searches a way to a stop across the water, and loads nothing for it', () => {
    // A water column cuts the far house off from the near one.
    const sim = new Simulation({
      seed: 3,
      content: testContent(),
      map: waterColumnMap(MAP_W, MAP_H, NEAR_X + 2),
    });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, []);
    const trader = traderOnFoot(sim, NEAR_X);
    woodRoute(sim, trader, near, far);

    let searched = false;
    for (let tick = 0; tick < 2 * RUN_TICKS; tick++) {
      sim.step();
      searched ||= sim.world.tryGet(trader, PathRequest)?.failed === true;
    }

    expect(searched).toBe(false);
    expect(stockOf(sim, near, WOOD)).toBe(10);
    expect(stockOf(sim, far, WOOD)).toBe(0);
  });

  it('walks where the player sends it mid-stop, then takes its cart up again and trades on', () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN, [[WOOD, 0]]);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    const loading = (): boolean => sim.world.tryGet(trader, CurrentAtomic)?.effect?.kind === 'tradeLoad';
    for (let tick = 0; tick < RUN_TICKS && !loading(); tick++) sim.step();
    expect(loading()).toBe(true);

    sim.enqueue(
      playerCommand(HUMAN, { kind: 'moveUnit', entity: trader, x: ORDER_NODE.hx, y: ORDER_NODE.hy }),
    );
    let arrived = false;
    for (let tick = 0; tick < RUN_TICKS && !arrived; tick++) {
      sim.step();
      const pos = sim.world.get(trader, Position);
      const node = nodeOfPosition(pos.x, pos.y);
      arrived = node.hx === ORDER_NODE.hx && node.hy === ORDER_NODE.hy;
    }
    expect(arrived).toBe(true);

    sim.run(RUN_TICKS); // the route resumes, the cart picked up where it was left
    expect(stockOf(sim, far, WOOD)).toBe(10);
    expect(sim.world.has(trader, HaulingCart)).toBe(true);
  });
});

describe('a trader at a foreign house', () => {
  function tradingWorld(
    onFoot = false,
    rate: { readonly wood: number; readonly planks: number; readonly woodAtHome: number } = {
      wood: 1,
      planks: 2,
      woodAtHome: 6,
    },
  ): {
    sim: Simulation;
    home: Entity;
    post: Entity;
    trader: Entity;
  } {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, rate.woodAtHome]]);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, 8]], TRADING_POST_ID);
    const trader = onFoot ? traderOnFoot(sim, NEAR_X) : traderAt(sim, NEAR_X);
    befriend(sim, NEIGHBOUR);
    offerWoodForPlanks(sim, rate.wood, rate.planks);
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    return { sim, home, post, trader };
  }

  it('hands the give goods over, brings the take goods home and tallies them for the ledger', () => {
    const { sim, home, post, trader } = tradingWorld();

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, home, PLANK)).toBeGreaterThan(0);
    const received = goodsTradedWith(sim.world, HUMAN, NEIGHBOUR);
    expect(received).toBeGreaterThanOrEqual(2);
    // Two planks per wood, and the ledger counts every plank the cart took aboard.
    expect(received).toBe(8 - stockOf(sim, post, PLANK));
    expect(stockOf(sim, home, PLANK) + holdOf(sim, trader, PLANK)).toBe(received);
    expect(sim.traderView(trader)?.agreementHolds).toBe(true);
    expect(goodsTradedWith(sim.world, NEIGHBOUR, HUMAN)).toBe(0);
  });

  it('shuttles an exchange larger than its hands on foot, a unit a trip each way', () => {
    const { sim, home, post } = tradingWorld(true);

    sim.run(SHUTTLE_TICKS);

    // Four wood bought all eight planks, each carried home by hand.
    expect(stockOf(sim, post, WOOD)).toBe(4);
    expect(stockOf(sim, home, PLANK)).toBe(8);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(8);
  });

  it('shuttles an exchange that gives more than it takes on foot, the give goods over two trips', () => {
    const { sim, home, post } = tradingWorld(true, { wood: 2, planks: 1, woodAtHome: 6 });

    sim.run(SHUTTLE_TICKS);

    // Three batches of two wood, each paid with one plank.
    expect(stockOf(sim, post, WOOD)).toBe(6);
    expect(stockOf(sim, home, PLANK)).toBe(3);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(3);
  });

  it('shuttles an exchange larger than its cart over two loads', () => {
    const { sim, home, post } = tradingWorld(false, {
      wood: CART_OVERSIZED_GIVE,
      planks: 2,
      woodAtHome: 2 * CART_OVERSIZED_GIVE,
    });

    sim.run(2 * SHUTTLE_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(2 * CART_OVERSIZED_GIVE);
    expect(stockOf(sim, home, PLANK)).toBe(4);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(4);
  });

  it('sets the take goods a full home refuses down on the ground by its door', () => {
    for (const onFoot of [true, false]) {
      const { sim, home, post } = fullHomeTrade(onFoot);

      sim.run(2 * SHUTTLE_TICKS);

      expect(stockOf(sim, post, PLANK)).toBe(0);
      expect(groundUnits(sim, PLANK)).toBe(PARTNER_PLANKS);
      expect(stockOf(sim, home, PLANK)).toBe(HEADQUARTERS_WOOD_ROOM);
    }
  });

  it('starts no batch for a full home whose door has no ground with room', () => {
    for (const onFoot of [true, false]) {
      const { sim, home, post } = fullHomeTrade(onFoot);
      coverDoorGround(sim, home);

      sim.run(SHUTTLE_TICKS);

      expect(stockOf(sim, post, PLANK)).toBe(PARTNER_PLANKS);
      expect(stockOf(sim, home, WOOD)).toBe(PLENTY_OF_WOOD);
    }
  });

  it('brings a unit in its hands home once its agreement is dropped', () => {
    const { sim, home, trader } = tradingWorld(true);
    for (
      let tick = 0;
      tick < SHUTTLE_TICKS && sim.world.tryGet(trader, Carrying)?.goodType !== PLANK;
      tick++
    ) {
      sim.step();
    }
    expect(sim.world.get(trader, Carrying).goodType).toBe(PLANK);

    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: -1 }));
    sim.run(RUN_TICKS);

    expect(sim.world.has(trader, Carrying)).toBe(false);
    expect(stockOf(sim, home, PLANK)).toBe(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR));
  });

  it('keeps its agreement when a fallen own stop is replaced before the trader plans again', () => {
    const { sim, home, post, trader } = tradingWorld();
    sim.run(TRADE_START_TICKS);

    sim.world.destroy(home);
    expect(sim.traderView(trader)?.stops.map((stop) => stop.foreign)).toEqual([false, true]);
    expect(sim.traderView(trader)?.agreementHolds).toBe(true);
    const rebuilt = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
    attach(sim, trader, rebuilt);
    sim.step();

    const route = sim.world.get(trader, TradeRoute);
    expect(route.stops.map((stop) => stop.house)).toEqual([rebuilt, post]);
    expect(route.agreement).toBe(0);
  });

  it('answers a dish in the agreement with the edible its houses hold', () => {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, HUMAN, [[FOOD, 4]]);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, 8]], TRADING_POST_ID);
    const trader = traderAt(sim, NEAR_X);
    befriend(sim, NEIGHBOUR);
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

  it('takes only an agreement its foreign stop offers', () => {
    const { sim, trader } = tradingWorld();
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: OTHER_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 1,
    });
    sim.step();
    expect(sim.traderView(trader)?.agreement).toBe(0);

    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 1 }));
    sim.step();
    expect(sim.traderView(trader)?.agreement).toBe(0);

    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: -1 }));
    sim.step();
    expect(sim.traderView(trader)?.agreement).toBe(-1);
  });

  it('takes no agreement on a route without a foreign stop', () => {
    const sim = newSim();
    offerWoodForPlanks(sim);
    const near = houseAt(sim, NEAR_X, HUMAN);
    const far = houseAt(sim, FAR_X, HUMAN);
    const trader = traderAt(sim, NEAR_X);
    attach(sim, trader, near);
    attach(sim, trader, far);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    sim.step();

    expect(sim.traderView(trader)?.agreement).toBe(-1);
  });

  it("trades nothing once the trader's player is no friend of the partner", () => {
    const { sim, home, post } = tradingWorld();
    sim.step();
    sim.enqueue(adminCommand({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'neutral' }));

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(0);
    expect(stockOf(sim, home, PLANK)).toBe(0);
    expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBe(0);
  });

  it('carries its route, cart and tally through a save and back', () => {
    const { sim } = tradingWorld();
    sim.run(RUN_TICKS / 3);

    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassMap(MAP_W, MAP_H),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(saved);
  });
});

describe('a route whose owners a map script changes', () => {
  it("stops carting between its old owner's houses once the trader is handed to another player", () => {
    const sim = newSim();
    const near = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 10]]);
    const far = houseAt(sim, FAR_X, HUMAN);
    const trader = traderAt(sim, NEAR_X);
    woodRoute(sim, trader, near, far);
    sim.step();

    // As `ChangePlayerIdInArea` does to a trader and its cart standing in the area, not to the houses.
    stampOwner(sim.world, trader, NEIGHBOUR);
    stampOwner(sim.world, cartOfTrader(sim, trader), NEIGHBOUR);
    sim.run(RUN_TICKS);

    expect(stockOf(sim, near, WOOD)).toBe(10);
    expect(stockOf(sim, far, WOOD)).toBe(0);
    expect(sim.traderView(trader)?.stops.map((stop) => stop.foreign)).toEqual([true, true]);
  });

  it("works a trading house handed to the trader's player as its own: marks, no exchange, no tally", () => {
    const sim = newSim();
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
    const post = houseAt(sim, FAR_X, NEIGHBOUR, [[PLANK, 8]], TRADING_POST_ID);
    const trader = traderAt(sim, NEAR_X);
    befriend(sim, NEIGHBOUR);
    offerWoodForPlanks(sim);
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    sim.step();

    stampOwner(sim.world, post, HUMAN);
    mark(sim, trader, home, PLANK);
    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(0);
    expect(stockOf(sim, home, PLANK) + holdOf(sim, trader, PLANK)).toBe(8);
    expect(goodsTradedWith(sim.world, HUMAN, HUMAN)).toBe(0);
    expect(sim.traderView(trader)?.agreementHolds).toBe(false);
  });
});

describe('the houses a map agreement applies to', () => {
  function offersIn(match: readonly number[], aiSeats: readonly number[], owner: number): number {
    const sim = newSim();
    const post = houseAt(sim, FAR_X, owner, [], TRADING_POST_ID);
    sim.enqueueSetup({ kind: 'setMatchParticipants', players: match });
    for (const player of aiSeats) sim.enqueueSetup({ kind: 'setAiControl', player, enabled: true });
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
    ai: { mapAiEnabled: boolean } | null,
    stock: Array<[number, number]> = [],
    buildingType = HEADQUARTERS,
  ): { sim: Simulation; post: Entity } {
    const sim = newSim();
    const post = houseAt(sim, FAR_X, NEIGHBOUR, stock, TRADING_POST_ID);
    sim.world.mut(post, Building).buildingType = buildingType;
    if (ai !== null) {
      sim.enqueueSetup({
        kind: 'setAiControl',
        player: NEIGHBOUR,
        enabled: true,
        mapAiEnabled: ai.mapAiEnabled,
      });
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
    const { sim, post } = partnerWorld({ mapAiEnabled: true });

    sim.run(tickOfTurn(0) + 1);
    expect(stockOf(sim, post, PLANK)).toBe(AI_STOCK_REFILL_LEVEL);

    sim.world.mut(post, Stockpile).amounts.set(PLANK, 0);
    sim.run(tickOfTurn(AI_STOCK_REFILL_TURNS - 1) + 1 - sim.tick);
    expect(stockOf(sim, post, PLANK)).toBe(0);

    sim.run(tickOfTurn(AI_STOCK_REFILL_TURNS) + 1 - sim.tick);
    expect(stockOf(sim, post, PLANK)).toBe(AI_STOCK_REFILL_LEVEL);
  });

  it('leaves a fuller shelf and every other good as they are', () => {
    const { sim, post } = partnerWorld({ mapAiEnabled: true }, [
      [PLANK, 9],
      [WOOD, 2],
    ]);

    sim.run(tickOfTurn(0) + 1);

    expect(stockOf(sim, post, PLANK)).toBe(9);
    expect(stockOf(sim, post, WOOD)).toBe(2);
  });

  it('is refilled on a seat the map switched off too', () => {
    const { sim, post } = partnerWorld({ mapAiEnabled: false });

    sim.run(tickOfTurn(0) + 1);

    expect(stockOf(sim, post, PLANK)).toBe(AI_STOCK_REFILL_LEVEL);
  });

  it('stays empty for a human seat and for a house that is no warehouse', () => {
    const worlds = [partnerWorld(null), partnerWorld({ mapAiEnabled: true }, [], SAWMILL)];
    for (const { sim, post } of worlds) {
      sim.run(tickOfTurn(0) + 1);

      expect(stockOf(sim, post, PLANK)).toBe(0);
    }
  });

  it('keeps a trader at the house through the refills until its whole load is sold', () => {
    const { sim, post } = partnerWorld({ mapAiEnabled: true });
    const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, PLENTY_OF_WOOD]]);
    const trader = traderAt(sim, NEAR_X);
    befriend(sim, NEIGHBOUR);
    attach(sim, trader, home);
    attach(sim, trader, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

    let loaded = 0;
    while (stockOf(sim, home, PLANK) === 0 && sim.tick < SELL_OUT_TICKS) {
      sim.run(1);
      loaded = Math.max(loaded, holdOf(sim, trader, WOOD));
    }

    // More wood than one refill pays for went out, and all of it was sold before the planks came home.
    expect(loaded * 2).toBeGreaterThan(AI_STOCK_REFILL_LEVEL);
    expect(stockOf(sim, home, PLANK)).toBeGreaterThan(0);
    expect(stockOf(sim, post, WOOD)).toBe(loaded);
  });

  it('pays a trader out of a house the map authored empty, on a switched-off seat as well', () => {
    for (const mapAiEnabled of [true, false]) {
      const { sim, post } = partnerWorld({ mapAiEnabled });
      const home = houseAt(sim, NEAR_X, HUMAN, [[WOOD, 6]]);
      const trader = traderAt(sim, NEAR_X);
      befriend(sim, NEIGHBOUR);
      attach(sim, trader, home);
      attach(sim, trader, post);
      sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));

      sim.run(RUN_TICKS);

      expect(goodsTradedWith(sim.world, HUMAN, NEIGHBOUR)).toBeGreaterThanOrEqual(2);
      expect(stockOf(sim, home, PLANK) + holdOf(sim, trader, PLANK)).toBeGreaterThan(0);
    }
  });
});
