import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  HaulingCart,
  MissionObjectId,
  Owner,
  Position,
  Stockpile,
  setStockAmount,
  TRADE_LIMIT_NONE,
  TradeRoute,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
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
import { createSignpost } from '../../../src/systems/signposts/index.js';
import { isLoosePile } from '../../../src/systems/stores/index.js';
import { standsForSettlement } from '../../../src/systems/trade/settlement.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../../fixtures/terrain.js';

/**
 * A trader's own storehouse stop set to its whole settlement loads out of the storehouse first, then
 * out of the storehouses and producing workshops its goods search reaches, and keeps a reserve summed
 * over them; what the route brings back still goes into the storehouse. An agreement's limits keep the
 * give good back at home and stop new batches once home holds enough of the take good.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const TRADER = 25;
const HANDCART = 1;
const OXCART = 2;
const WOOD = 1;
const PLANK = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const TRADING_POST_ID = 700;
/** The settlement's storehouse, a second house of it, and the route's other stop, left to right. */
const ANCHOR_X = 1;
const MEMBER_X = 4;
const OTHER_X = 7;
/** Further than the goods search reaches from the anchor's door (40 nodes, 20 cells). */
const OUT_OF_REACH_X = 26;
const MAP_W = 30;
/** A water column that cuts the settlement house past it off from the cart. */
const WATER_X = OUT_OF_REACH_X - 2;
const MAP_H = 3;
const RUN_TICKS = 2000;
const WOOD_HELD = 6;
const WOOD_KEPT = 5;
/** Wood lying loose on the ground between the stops, off both doors' heaps. */
const GROUND_WOOD = 3;
/** The row below the houses. */
const GROUND_ROW = 2;
/** A house type whose walls cover its own node, so a pile laid there lies buried. */
const WALLED_HUT = 95;
/** A node between the stops, under the hut's walls. */
const BURIED_NODE = { hx: 2 * MEMBER_X, hy: 2 * GROUND_ROW };
/** The agreement's planks once home holds them, two per wood. */
const PLANKS_WANTED = 4;

function newSim(map = grassMap(MAP_W, MAP_H), content: ContentSet = testContent()): Simulation {
  const sim = new Simulation({ seed: 3, content, map });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

/** The fixture content with {@link WALLED_HUT}. */
function walledContent(): ContentSet {
  const content = testContent();
  return parseContentSet({
    ...content,
    manifest: TEST_MANIFEST,
    buildings: [
      ...content.buildings,
      { typeId: WALLED_HUT, id: 'walled_hut', kind: 'home', footprint: { blocked: [{ dx: 0, dy: 0 }] } },
    ],
  });
}

function houseAt(
  sim: Simulation,
  x: number,
  stock: Array<[number, number]> = [],
  options: { owner?: number; type?: number; missionId?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Building, {
    buildingType: options.type ?? HEADQUARTERS,
    tribe: VIKING,
    built: ONE,
    level: 0,
  });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: options.owner ?? HUMAN });
  if (options.missionId !== undefined) sim.world.add(e, MissionObjectId, { id: options.missionId });
  return e;
}

/** A trader at `x` handed a cart of `vehicleType` standing beside it. */
function traderAt(sim: Simulation, x: number, vehicleType = HANDCART): Entity {
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
    vehicleType,
    x: 2 * x,
    y: 0,
    tribe: VIKING,
    owner: HUMAN,
  });
  if (cart === null) throw new Error('cart type not in the fixture');
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  return trader;
}

/** A loose pile of `wood` on the ground at cell `x` of the row below the houses. */
function groundPileAt(sim: Simulation, x: number, wood: number): Entity {
  const pile = sim.world.create();
  sim.world.add(pile, Position, { x: fx.fromInt(x), y: fx.fromInt(GROUND_ROW) });
  sim.world.add(pile, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  return pile;
}

/** The wood lying loose on the ground. */
function groundWood(sim: Simulation): number {
  let units = 0;
  for (const e of sim.world.query(Stockpile))
    if (isLoosePile(sim.world, e)) units += sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
  return units;
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

function route(sim: Simulation, trader: Entity, first: Entity, second: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: first }));
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: second }));
}

function settle(sim: Simulation, trader: Entity, house: Entity, on = true): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeSettlement', entity: trader, house, on }));
}

/** Carry wood into `into`, keeping `keep` back at the other stop. */
function woodInto(sim: Simulation, trader: Entity, into: Entity, upTo = TRADE_LIMIT_NONE, keep = 0): void {
  sim.enqueue(
    playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: into, good: WOOD, on: true }),
  );
  sim.enqueue(
    playerCommand(HUMAN, {
      kind: 'setTradeImportLimits',
      entity: trader,
      house: into,
      good: WOOD,
      upTo,
      keep,
    }),
  );
}

describe('a settlement stop between own houses', () => {
  it('loads out of the other storehouses of its settlement, and only once set to it', () => {
    for (const settled of [false, true]) {
      const sim = newSim();
      const anchor = houseAt(sim, ANCHOR_X);
      const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
      const other = houseAt(sim, OTHER_X);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, anchor, other);
      woodInto(sim, trader, other);
      if (settled) settle(sim, trader, anchor);

      sim.run(RUN_TICKS);

      expect(stockOf(sim, other, WOOD)).toBe(settled ? WOOD_HELD : 0);
      expect(stockOf(sim, member, WOOD)).toBe(settled ? 0 : WOOD_HELD);
    }
  });

  it("counts the wood lying on its settlement's ground toward its mark's ceiling, and only once set to it", () => {
    for (const settled of [false, true]) {
      const sim = newSim();
      const near = houseAt(sim, ANCHOR_X, [[WOOD, WOOD_HELD]]);
      const other = houseAt(sim, OTHER_X);
      groundPileAt(sim, MEMBER_X, GROUND_WOOD);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, near, other);
      woodInto(sim, trader, other, WOOD_KEPT);
      if (settled) settle(sim, trader, other);

      sim.run(RUN_TICKS);

      const carried = settled ? WOOD_KEPT - GROUND_WOOD : WOOD_KEPT;
      expect(stockOf(sim, other, WOOD)).toBe(carried);
      expect(stockOf(sim, near, WOOD)).toBe(WOOD_HELD - carried);
    }
  });

  it('leaves a pile buried under standing walls out of its count, as no fetcher reaches it', () => {
    const sim = newSim(grassMap(MAP_W, MAP_H), walledContent());
    const near = houseAt(sim, ANCHOR_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(BURIED_NODE.hx, BURIED_NODE.hy));
    sim.world.add(hut, Building, { buildingType: WALLED_HUT, tribe: VIKING, built: ONE, level: 0 });
    const buried = sim.world.create();
    sim.world.add(buried, Position, positionOfNode(BURIED_NODE.hx, BURIED_NODE.hy));
    sim.world.add(buried, Stockpile, { amounts: new Map([[WOOD, GROUND_WOOD]]) });
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, near, other);
    woodInto(sim, trader, other, WOOD_KEPT);
    settle(sim, trader, other);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, buried, WOOD)).toBe(GROUND_WOOD);
  });

  it("loads the wood lying on its settlement's ground, its stores empty", () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const other = houseAt(sim, OTHER_X);
    groundPileAt(sim, MEMBER_X, GROUND_WOOD);
    groundPileAt(sim, MEMBER_X + 1, GROUND_WOOD);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(2 * GROUND_WOOD);
    expect(groundWood(sim)).toBe(0);
  });

  it('takes from its own storehouse first', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, 3]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, 3]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other, 3);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(3);
    expect(stockOf(sim, anchor, WOOD)).toBe(0);
    expect(stockOf(sim, member, WOOD)).toBe(3);
  });

  it('empties the settlement house it stands at before turning back for a unit dropped at home', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);
    let ticks = 0;
    while (stockOf(sim, member, WOOD) === WOOD_HELD && ticks++ < RUN_TICKS) sim.step();
    setStockAmount(sim.world, anchor, WOOD, 1);
    while (stockOf(sim, member, WOOD) > 0 && ticks++ < RUN_TICKS) sim.step();

    expect(stockOf(sim, member, WOOD)).toBe(0);
    expect(stockOf(sim, anchor, WOOD)).toBe(1);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(WOOD_HELD + 1);
  });

  it('keeps the reserve summed over the settlement', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, 2]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other, TRADE_LIMIT_NONE, WOOD_KEPT);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, member, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, other, WOOD)).toBe(2 + WOOD_HELD - WOOD_KEPT);
  });

  it('counts a storage minimum’s surplus once across the settlement’s storehouses', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, WOOD_HELD]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    // The two storehouses spare WOOD_KEPT - 1 units between them, each alone up to that many.
    const minimum = 2 * WOOD_HELD - (WOOD_KEPT - 1);
    sim.enqueueSetup({ kind: 'setStorageMinimum', player: HUMAN, goodType: WOOD, amount: minimum });
    woodInto(sim, trader, other, TRADE_LIMIT_NONE, WOOD_KEPT);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(0);
    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, member, WOOD)).toBe(2 * WOOD_HELD);
  });

  it('never loads out of the stop it carries into', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const other = houseAt(sim, OTHER_X, [[WOOD, WOOD_HELD]]);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(WOOD_HELD);
    expect(stockOf(sim, anchor, WOOD)).toBe(0);
  });

  it("loads a workshop's output, never its input", () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const sawmill = houseAt(
      sim,
      MEMBER_X,
      [
        [WOOD, WOOD_HELD],
        [PLANK, WOOD_HELD],
      ],
      { type: SAWMILL },
    );
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: other, good: PLANK, on: true }),
    );
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, PLANK)).toBe(WOOD_HELD);
    expect(stockOf(sim, sawmill, WOOD)).toBe(WOOD_HELD);
  });

  it('reaches as far as its goods search under signpost navigation, everywhere without it', () => {
    for (const navigation of [true, false]) {
      const sim = newSim();
      sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: navigation });
      const anchor = houseAt(sim, ANCHOR_X);
      const far = houseAt(sim, OUT_OF_REACH_X, [[WOOD, WOOD_HELD]]);
      const other = houseAt(sim, OTHER_X);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, anchor, other);
      woodInto(sim, trader, other);
      settle(sim, trader, anchor);

      sim.run(2 * RUN_TICKS);

      expect(stockOf(sim, far, WOOD)).toBe(navigation ? WOOD_HELD : 0);
    }
  });

  it('keeps its cart and loads elsewhere when it cannot reach a settlement house', () => {
    const sim = newSim(waterColumnMap(MAP_W, MAP_H, WATER_X));
    const anchor = houseAt(sim, ANCHOR_X);
    const member = houseAt(sim, MEMBER_X, [[WOOD, 3]]);
    const island = houseAt(sim, OUT_OF_REACH_X, [[WOOD, 3]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);

    sim.run(2 * RUN_TICKS);

    expect(stockOf(sim, member, WOOD)).toBe(0);
    expect(stockOf(sim, other, WOOD)).toBe(3);
    expect(stockOf(sim, island, WOOD)).toBe(3);
    expect(sim.world.has(trader, HaulingCart)).toBe(true);
  });

  it('is set on an own storehouse alone, on one stop of a shared settlement, and shown on the trader view', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const sawmill = houseAt(sim, MEMBER_X, [], { type: SAWMILL });
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, sawmill, other);
    settle(sim, trader, sawmill);
    sim.step();
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.settlement)).toEqual([false, false]);

    route(sim, trader, anchor, other);
    settle(sim, trader, anchor);
    settle(sim, trader, other);
    sim.step();

    const view = sim.traderView(trader);
    expect(view?.stops.map((stop) => [stop.house, stop.settlement, stop.settles])).toEqual([
      [anchor, true, true],
      [other, false, true],
    ]);
  });
});

describe('a settlement stop before a foreign trip', () => {
  function tradingWorld(home: Array<[number, number]>, member: Array<[number, number]>) {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, home);
    const neighbour = houseAt(sim, MEMBER_X, member);
    const post = houseAt(sim, OTHER_X, [[PLANK, 40]], { owner: NEIGHBOUR, missionId: TRADING_POST_ID });
    const trader = traderAt(sim, ANCHOR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    route(sim, trader, anchor, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    return { sim, anchor, neighbour, post, trader };
  }

  function limits(sim: Simulation, trader: Entity, giveKeep: number, takeUpTo: number): void {
    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeAgreementLimits', entity: trader, giveKeep, takeUpTo }),
    );
  }

  it('gives goods out of the whole settlement and brings what it takes to the storehouse', () => {
    const { sim, anchor, neighbour, post, trader } = tradingWorld([], [[WOOD, 3]]);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(3);
    expect(stockOf(sim, anchor, PLANK)).toBe(6);
    expect(stockOf(sim, neighbour, PLANK)).toBe(0);
  });

  it('keeps the give good back at home', () => {
    const { sim, anchor, neighbour, post, trader } = tradingWorld([[WOOD, 2]], [[WOOD, WOOD_HELD]]);
    settle(sim, trader, anchor);
    limits(sim, trader, WOOD_KEPT, TRADE_LIMIT_NONE);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, neighbour, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, post, WOOD)).toBe(2 + WOOD_HELD - WOOD_KEPT);
  });

  it('starts no batch once home holds the take good it is filled up to', () => {
    const { sim, anchor, post, trader } = tradingWorld([[WOOD, WOOD_HELD]], []);
    limits(sim, trader, TRADE_LIMIT_NONE, PLANKS_WANTED);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, PLANK)).toBe(PLANKS_WANTED);
    expect(stockOf(sim, post, WOOD)).toBe(PLANKS_WANTED / 2);
    expect(sim.traderView(trader)).toMatchObject({ giveKeep: TRADE_LIMIT_NONE, takeUpTo: PLANKS_WANTED });
  });

  it('drops the limits with the agreement, and takes none without one', () => {
    const { sim, trader } = tradingWorld([], []);
    limits(sim, trader, WOOD_KEPT, PLANKS_WANTED);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: -1 }));
    limits(sim, trader, WOOD_KEPT, PLANKS_WANTED);
    sim.step();

    expect(sim.world.get(trader, TradeRoute)).toMatchObject({
      agreement: -1,
      giveKeep: TRADE_LIMIT_NONE,
      takeUpTo: TRADE_LIMIT_NONE,
    });
  });

  it('carries the settlement and limits through a save and back', () => {
    const { sim, anchor, trader } = tradingWorld([[WOOD, 2]], [[WOOD, WOOD_HELD]]);
    settle(sim, trader, anchor);
    limits(sim, trader, 1, PLANKS_WANTED);
    sim.run(RUN_TICKS / 4);

    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassMap(MAP_W, MAP_H),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(saved);
  });
});

describe('two stops standing for their settlements', () => {
  /** Two settlements on one continent, each a storehouse with a second one behind it, further apart than
   *  one goods search reaches (40 nodes). */
  const PAIR_MAP_W = 32;
  const A_MEMBER_X = 1;
  const A_X = 4;
  const B_X = 26;
  const B_MEMBER_X = 29;
  /** Inside both goods searches: a house here joins the two settlements. */
  const MIDDLE_X = 15;
  const ISLAND_X = 26;
  const STOCK_LEVEL = 20;
  const B_HELD = 12;
  const B_MEMBER_HELD = 10;
  const B_KEEP = 30;
  const B_WOOD = 25;
  const B_MEMBER_WOOD = 15;
  const A_WOOD = 30;
  const BALANCE_SIDE = 10;
  const SLOW_RUN_TICKS = 3 * RUN_TICKS;
  /** Leaves 2 of the member's 5 to go when the settlement ends at its continent. */
  const CONTINENT_KEEP = 3;
  /** A continent whose far storehouse lies 120 nodes from the first, past any two goods searches. */
  const FAR_MAP_W = 68;
  const FAR_B_X = 64;
  const FAR_RUN_TICKS = 6 * RUN_TICKS;

  function pairSim(map = grassMap(PAIR_MAP_W, MAP_H), navigation = true): Simulation {
    const sim = newSim(map);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: navigation });
    return sim;
  }

  /** A signpost on the cell at `x` of the houses' row. */
  function postAt(sim: Simulation, x: number): void {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the sim has a map');
    createSignpost(sim.world, terrain, terrain.nodeAt(2 * x + 1, 2), HUMAN);
  }

  function flags(sim: Simulation, trader: Entity): boolean[] {
    return sim.world.get(trader, TradeRoute).stops.map((stop) => stop.settlement);
  }

  function mark(sim: Simulation, trader: Entity, into: Entity, upTo = TRADE_LIMIT_NONE, keep = 0): void {
    woodInto(sim, trader, into, upTo, keep);
  }

  it('may stand on both stops across two islands', () => {
    const sim = pairSim(waterColumnMap(MAP_W, MAP_H, WATER_X), false);
    const a = houseAt(sim, ANCHOR_X);
    const b = houseAt(sim, ISLAND_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, a, b);
    settle(sim, trader, a);
    settle(sim, trader, b);
    sim.step();

    expect(flags(sim, trader)).toEqual([true, true]);
  });

  it('stands on one stop alone when one signpost network joins the two', () => {
    const sim = pairSim();
    const a = houseAt(sim, A_X);
    const b = houseAt(sim, B_X);
    for (const x of [A_X, MIDDLE_X, B_X]) postAt(sim, x);
    const trader = traderAt(sim, A_X);
    route(sim, trader, a, b);
    settle(sim, trader, a);
    settle(sim, trader, b);
    sim.step();

    expect(flags(sim, trader)).toEqual([true, false]);
    expect(sim.traderView(trader)?.stops.map((stop) => stop.sharesSettlement)).toEqual([false, true]);
  });

  it('may stand on both stops of one continent whose signpost networks share no house', () => {
    const sim = pairSim();
    const a = houseAt(sim, A_X);
    const b = houseAt(sim, B_X);
    postAt(sim, A_X);
    postAt(sim, B_X);
    const trader = traderAt(sim, A_X);
    route(sim, trader, a, b);
    settle(sim, trader, a);
    settle(sim, trader, b);
    sim.step();

    expect(flags(sim, trader)).toEqual([true, true]);
  });

  it("fills a stop up to its mark counting its settlement's stock", () => {
    for (const settled of [true, false]) {
      const sim = newSim();
      const a = houseAt(sim, ANCHOR_X, [[WOOD, A_WOOD]]);
      const bMember = houseAt(sim, MEMBER_X, [[WOOD, B_MEMBER_HELD]]);
      const b = houseAt(sim, OTHER_X, [[WOOD, B_HELD]]);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, a, b);
      mark(sim, trader, b, STOCK_LEVEL);
      if (settled) settle(sim, trader, b);

      sim.run(RUN_TICKS);

      expect(stockOf(sim, b, WOOD)).toBe(settled ? B_HELD : STOCK_LEVEL);
      expect(stockOf(sim, a, WOOD)).toBe(settled ? A_WOOD : A_WOOD - (STOCK_LEVEL - B_HELD));
      expect(stockOf(sim, bMember, WOOD)).toBe(B_MEMBER_HELD);
    }
  });

  it('keeps its reserve summed over its settlement on the way out', () => {
    const sim = newSim();
    const a = houseAt(sim, ANCHOR_X);
    const bMember = houseAt(sim, MEMBER_X, [[WOOD, B_MEMBER_WOOD]]);
    const b = houseAt(sim, OTHER_X, [[WOOD, B_WOOD]]);
    const trader = traderAt(sim, OTHER_X);
    route(sim, trader, a, b);
    mark(sim, trader, a, TRADE_LIMIT_NONE, B_KEEP);
    settle(sim, trader, b);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, b, WOOD) + stockOf(sim, bMember, WOOD)).toBe(B_KEEP);
    expect(stockOf(sim, a, WOOD)).toBe(B_WOOD + B_MEMBER_WOOD - B_KEEP);
  });

  it('balances a good both stops mark between the two settlements', () => {
    const sim = pairSim();
    const aMember = houseAt(sim, A_MEMBER_X, [[WOOD, BALANCE_SIDE]]);
    const a = houseAt(sim, A_X, [[WOOD, BALANCE_SIDE]]);
    const b = houseAt(sim, B_X);
    const bMember = houseAt(sim, B_MEMBER_X);
    const trader = traderAt(sim, A_X);
    route(sim, trader, a, b);
    mark(sim, trader, a);
    mark(sim, trader, b);
    settle(sim, trader, a);
    settle(sim, trader, b);

    sim.run(SLOW_RUN_TICKS);

    expect(flags(sim, trader)).toEqual([true, true]);
    expect(stockOf(sim, a, WOOD) + stockOf(sim, aMember, WOOD)).toBe(BALANCE_SIDE);
    expect(stockOf(sim, b, WOOD) + stockOf(sim, bMember, WOOD)).toBe(BALANCE_SIDE);
  });

  it('bounds a settlement by its continent with signpost navigation off', () => {
    const sim = newSim(waterColumnMap(MAP_W, MAP_H, WATER_X));
    const a = houseAt(sim, ANCHOR_X);
    houseAt(sim, MEMBER_X, [[WOOD, WOOD_KEPT]]);
    houseAt(sim, ISLAND_X, [[WOOD, WOOD_KEPT]]);
    const b = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, a, b);
    mark(sim, trader, b, TRADE_LIMIT_NONE, CONTINENT_KEEP);
    settle(sim, trader, a);

    sim.run(RUN_TICKS);

    // The island's wood would raise the settlement to 10 and let the whole member's 5 go.
    expect(stockOf(sim, b, WOOD)).toBe(WOOD_KEPT - CONTINENT_KEEP);
  });

  it('serves two settlements at the far ends of one continent with an ox cart', () => {
    const sim = pairSim(grassMap(FAR_MAP_W, MAP_H));
    const aMember = houseAt(sim, A_MEMBER_X, [[WOOD, BALANCE_SIDE]]);
    const a = houseAt(sim, A_X);
    const b = houseAt(sim, FAR_B_X);
    postAt(sim, A_X);
    postAt(sim, FAR_B_X);
    const trader = traderAt(sim, A_X, OXCART);
    route(sim, trader, a, b);
    mark(sim, trader, b);
    settle(sim, trader, a);
    settle(sim, trader, b);

    sim.run(FAR_RUN_TICKS);

    expect(flags(sim, trader)).toEqual([true, true]);
    expect(sim.traderView(trader)?.stops.map((stop) => stop.settlementSuspended)).toEqual([false, false]);
    expect(stockOf(sim, aMember, WOOD)).toBe(0);
    expect(stockOf(sim, b, WOOD)).toBe(BALANCE_SIDE);
  });

  it('counts the second stop as its storehouse alone once the two settlements join', () => {
    for (const joined of [false, true]) {
      const sim = pairSim();
      const a = houseAt(sim, A_X);
      const b = houseAt(sim, B_X);
      const bMember = houseAt(sim, B_MEMBER_X, [[WOOD, B_MEMBER_HELD]]);
      const trader = traderAt(sim, A_X);
      route(sim, trader, a, b);
      mark(sim, trader, a);
      settle(sim, trader, a);
      settle(sim, trader, b);
      sim.step();
      if (joined) houseAt(sim, MIDDLE_X);

      sim.run(SLOW_RUN_TICKS);

      expect(flags(sim, trader)).toEqual([true, true]);
      expect(stockOf(sim, bMember, WOOD)).toBe(joined ? B_MEMBER_HELD : 0);
      expect(sim.traderView(trader)?.stops.map((stop) => stop.settlementSuspended)).toEqual([false, joined]);
    }
  });

  it('no longer holds the second stop aside once the first stop turns foreign', () => {
    const sim = pairSim();
    const a = houseAt(sim, A_X);
    const b = houseAt(sim, B_X);
    const trader = traderAt(sim, A_X);
    route(sim, trader, a, b);
    settle(sim, trader, a);
    settle(sim, trader, b);
    sim.step();
    houseAt(sim, MIDDLE_X);
    sim.step();
    expect(sim.traderView(trader)?.stops.map((stop) => stop.settlementSuspended)).toEqual([false, true]);

    sim.world.mut(a, Owner).player = NEIGHBOUR;
    sim.step();

    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the sim has a map');
    const stops = sim.world.get(trader, TradeRoute).stops;
    expect(sim.traderView(trader)?.stops.map((stop) => stop.settlementSuspended)).toEqual([false, false]);
    expect(standsForSettlement(sim.world, ctxOf(sim), terrain, trader, stops, 0)).toBe(false);
    expect(standsForSettlement(sim.world, ctxOf(sim), terrain, trader, stops, 1)).toBe(true);
  });
});
