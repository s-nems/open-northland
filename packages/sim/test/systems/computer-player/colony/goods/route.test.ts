import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  Settler,
  TRADE_LIMIT_NONE,
  TradeRoute,
  TradeShip,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import { homeBuildings, homeSettlers } from '../../../../../src/systems/ai-shared/home-roster.js';
import {
  RELIEF_AFTER_TICKS,
  routeBacklog,
  routeBehind,
  routeMarks,
} from '../../../../../src/systems/computer-player/colony/goods/route.js';
import { colonySmallShips } from '../../../../../src/systems/computer-player/colony/sea/fleet.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { addStock, stockOf } from '../../../../../src/systems/missions/stock.js';
import { isTraderJob } from '../../../../../src/systems/readviews/index.js';
import { stockAtBuildings } from '../../../../../src/systems/stores/index.js';
import { removeVehicle } from '../../../../../src/systems/vehicles/index.js';
import {
  colonyBuildingsOf,
  colonyContent,
  colonyIslands,
  colonyState,
  editColony,
  FOOD,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { routedWorld, routeTrader, standingTrader } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { CIVILIST, MUD, SEAT, STOCK_TOP_TYPE, STONE, VIKING } from '../../support.js';

const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const THIRD_SHIP_AT = { x: 90, y: 20 };
const HULL_HIT = 100;
const STRAIT_MID_HX = 114;
const STRAIT_ACROSS = [30, 60, 90];
const DANGER_LAPSED_TICKS = minutesToTicks(40);
/** Home's first warehouse of the route's tier, south of the headquarters. */
const FAR_STORE_AT = { x: 72, y: 84 };
/** A warehouse home raises by the berth later, nearer it than the route's home stop. */
const BERTH_STORE_AT = { x: 86, y: 64 };
/** The colony's stop on a colony route, home's being the first. */
const COLONY_STOP = 1;
/** A colony route's marks: the food a colony is filled up to and home keeps, the stone a colony site lacks,
 *  and what of each lies loose on home's ground. */
const COLONY_FOOD_UP_TO = 36;
const HOME_FOOD_KEPT = 34;
const COLONY_SITE_STONE = 8;
const FOOD_ON_HOME_GROUND = 12;
const STONE_ON_HOME_GROUND = 5;

/** Give the colony up, as its overrun read does. */
function abandon(sim: Simulation): void {
  const live = editColony(sim);
  live.phase = 'abandoned';
  live.since = sim.tick;
  live.people = [];
  live.rest = [];
  live.ship = null;
}

describe('a colony trade route', () => {
  it('pins the colony ship to a home trader between two settlements, and moves goods both ways', () => {
    const { sim, ship } = routedWorld();
    const trader = standingTrader(sim);
    expect(colonyState(sim)?.route?.ship).toBe(ship);
    expect(isTraderJob(ctxOf(sim).content, sim.world.get(trader, Settler).jobType)).toBe(true);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toContain(trader);
    const stops = sim.world.get(trader, TradeRoute).stops;
    const [home, colony] = stops;
    expect(homeBuildings(sim.world, ctxOf(sim), SEAT)).toContain(home?.house);
    expect(colonyBuildingsOf(sim)).toContain(colony?.house);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => stops.every((s) => s.settlement))).toBe(true);
    const marks = () => sim.world.get(trader, TradeRoute).stops;
    expect(stepUntil(sim, LEG_DUE_TICKS, () => (marks()[1]?.imports.length ?? 0) > 0)).toBe(true);
    expect(marks()[1]?.imports.some((m) => m.good === MUD)).toBe(true);
    const colonyHolds = (good: number): number =>
      stockAtBuildings(sim.world, SEAT, colonyBuildingsOf(sim)).get(good) ?? 0;
    let sentHome = false;
    // The colony's first mud and stone go into the home it raises ahead of its families, so the round runs a
    // leg longer; what it sends home is what it gathers past its floor.
    const both = stepUntil(sim, ROUND_DUE_TICKS + LEG_DUE_TICKS, () => {
      sentHome ||= (marks()[0]?.imports.length ?? 0) > 0;
      return colonyHolds(MUD) > 0 && sentHome && (colonyState(sim)?.delivered ?? null) !== null;
    });
    expect(both).toBe(true);
    // Its stone goes home once its men dig past what its own industries' sites took first.
    const stoneHome = () => marks()[0]?.imports.some((m) => m.good === STONE) === true;
    expect(stepUntil(sim, ROUND_DUE_TICKS, stoneHome)).toBe(true);
  });

  it('keeps its home stop when home raises a warehouse nearer the berth, so no voyage starts over', () => {
    const { sim } = routedWorld();
    const trader = standingTrader(sim);
    const homeStop = () => sim.world.get(trader, TradeRoute).stops[0]?.house;
    const raise = (at: { readonly x: number; readonly y: number }): void =>
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: STOCK_TOP_TYPE,
        ...at,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction: false,
      });
    const first = homeStop();
    raise(FAR_STORE_AT);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => homeStop() !== first)).toBe(true);
    const held = homeStop();
    raise(BERTH_STORE_AT);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => homeStop() !== held)).toBe(false);
  });

  it('owes a ship once its own is sunk, and pins the next free one', () => {
    const { sim, ship } = routedWorld();
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    sim.step();
    mooredShip(sim, SMALL_SHIP, THIRD_SHIP_AT);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => (colonyState(sim)?.route?.ship ?? ship) !== ship)).toBe(
      true,
    );
    expect(stepUntil(sim, LEG_DUE_TICKS, () => routeTrader(sim) !== null)).toBe(true);
  });

  it('comes back from a save in mid-route exactly as it would have gone on', () => {
    const { sim } = routedWorld();
    stepUntil(sim, LEG_DUE_TICKS, () => false);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: colonyContent(), map: colonyIslands() });
    expect(copy.hashState()).toBe(sim.hashState());
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(copy.hashState()).toBe(sim.hashState());
  });
});

/** Stone piled in the colony's store, far past one small ship's hold of 50, and the line it is topped up
 *  at, so the route stays behind however many trips it makes. */
const STONE_PILED = 200;
const STONE_TOPPED_BELOW = 150;
/** A small ship's hold in the fixture. */
const SMALL_HOLD = 50;
const ROUND_TICKS = minutesToTicks(15);
/** What is left of the span a route must stay behind for, when the test takes it over. */
const BEHIND_LEFT_TICKS = minutesToTicks(1);
/** The carriers a route seats on its ship as the trader's helpers. */
const ROUTE_HELPERS = 3;

describe('a colony route that cannot keep up', () => {
  it('counts what its marks ask past what the giving side keeps, each way', () => {
    const atColony = [{ good: STONE, upTo: 20, keep: 5 }];
    const atHome = [{ good: MUD, upTo: TRADE_LIMIT_NONE, keep: 10 }];
    const colony = (good: number) => (good === STONE ? 4 : 30);
    // The colony lacks 16 stone and home spares 7 past its keep; the colony holds 20 mud past its keep.
    expect(routeBacklog(atColony, atHome, colony, () => 12)).toBe(7 + 20);
    expect(
      routeBacklog(
        atColony,
        atHome,
        () => 40,
        () => 0,
      ),
    ).toBe(30);
  });

  it('is behind only while its marks ask more than a hold and it unloaded within a round', () => {
    const now = 10 * ROUND_TICKS;
    expect(routeBehind(SMALL_HOLD + 1, SMALL_HOLD, now - ROUND_TICKS, now)).toBe(true);
    expect(routeBehind(SMALL_HOLD, SMALL_HOLD, now, now)).toBe(false);
    expect(routeBehind(SMALL_HOLD + 1, SMALL_HOLD, now - ROUND_TICKS - 1, now)).toBe(false);
    expect(routeBehind(SMALL_HOLD + 1, SMALL_HOLD, null, now)).toBe(false);
  });

  it('raises a second trader and ship on the same stops once it has stayed behind', () => {
    const { sim } = routedWorld();
    const store = colonyBuildingsOf(sim).find(
      (e) => sim.world.get(e, Building).buildingType === STOCK_TOP_TYPE,
    );
    if (store === undefined) throw new Error('setup: no colony warehouse');
    /** Tops the colony's stone up, then reads `done`: the route stays behind on every tick asked. */
    const piled = (done: () => boolean) => (): boolean => {
      const held = stockOf(sim.world, store, STONE);
      if (held < STONE_TOPPED_BELOW) addStock(sim.world, store, STONE, STONE_PILED - held);
      return done();
    };
    const first = standingTrader(sim);
    const stoneHome = () =>
      sim.world.get(first, TradeRoute).stops[0]?.imports.some((m) => m.good === STONE) === true;
    expect(stepUntil(sim, LEG_DUE_TICKS, piled(stoneHome))).toBe(true);
    // Behind for all but the last minute of its span, and delivering: the next marks beat raises the relief.
    const live = editColony(sim);
    if (live.route === null) throw new Error('setup: no route');
    live.route.behindSince = sim.tick - RELIEF_AFTER_TICKS + BEHIND_LEFT_TICKS;
    live.delivered = sim.tick;
    const relief = () => (colonyState(sim)?.relief ?? null) !== null;
    expect(relief()).toBe(false);
    expect(stepUntil(sim, LEG_DUE_TICKS, piled(relief))).toBe(true);
    mooredShip(sim, SMALL_SHIP, THIRD_SHIP_AT);
    const reliefTrader = () => {
      const relief = colonyState(sim)?.relief ?? null;
      if (relief === null || relief.trader === null || relief.ship === null) return null;
      return sim.world.tryGet(relief.trader, TradeShip)?.vehicle === relief.ship ? relief.trader : null;
    };
    expect(
      stepUntil(
        sim,
        ROUND_DUE_TICKS,
        piled(() => reliefTrader() !== null),
      ),
    ).toBe(true);
    const second = reliefTrader();
    if (second === null) throw new Error('setup: no relief trader');
    expect(second).not.toBe(first);
    const stopsOf = (trader: Entity) =>
      (sim.world.tryGet(trader, TradeRoute)?.stops ?? []).map((stop) => stop.house);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => stopsOf(second).length === 2)).toBe(true);
    expect(stopsOf(second)).toEqual(stopsOf(first));
  });

  it('never shares a trader or a helper with its relief, even when both choose in one decision', () => {
    const { sim, ship } = routedWorld();
    const first = standingTrader(sim);
    const third = mooredShip(sim, SMALL_SHIP, THIRD_SHIP_AT);
    const live = editColony(sim);
    const hull = sim.world.get(third, Health).hitpoints;
    live.relief = { trader: null, chosen: sim.tick, ship: third, hull, load: 0, behindSince: null };
    // The first route's trader falls as the relief is raised: the next decision chooses a trader for both.
    sim.world.mut(first, Health).hitpoints = 0;
    const helpersOn = (vessel: Entity, trader: Entity | null): Entity[] =>
      vehiclePassengers(sim.world.get(vessel, Vehicle))
        .map((seat) => seat.entity)
        .filter((e) => e !== trader);
    let shared = false;
    const seating = stepUntil(sim, ROUND_DUE_TICKS, () => {
      const routeTrader = colonyState(sim)?.route?.trader ?? null;
      const reliefTrader = colonyState(sim)?.relief?.trader ?? null;
      shared ||= routeTrader !== null && routeTrader === reliefTrader;
      return helpersOn(ship, routeTrader).length > 0 || helpersOn(third, reliefTrader).length > 0;
    });
    expect(shared).toBe(false);
    expect(seating).toBe(true);
    // Both ships lie at home wanting helpers on the same workforce beat: each takes a full crew of its own.
    expect(helpersOn(ship, colonyState(sim)?.route?.trader ?? null)).toHaveLength(ROUTE_HELPERS);
    expect(helpersOn(third, colonyState(sim)?.relief?.trader ?? null)).toHaveLength(ROUTE_HELPERS);
  });
});

describe("a colony route's marks", () => {
  it("raise home's reserve of a good by what of it lies on home's ground, which home's stop counts as stock", () => {
    const policy = {
      inbound: [
        { good: FOOD, upTo: COLONY_FOOD_UP_TO, keep: HOME_FOOD_KEPT },
        { good: STONE, upTo: COLONY_SITE_STONE, keep: 0 },
      ],
      outbound: [],
    };
    const onHomeGround = (good: number): number =>
      good === FOOD ? FOOD_ON_HOME_GROUND : STONE_ON_HOME_GROUND;
    expect(routeMarks(policy, onHomeGround).atColony).toEqual([
      { good: FOOD, upTo: COLONY_FOOD_UP_TO, keep: HOME_FOOD_KEPT + FOOD_ON_HOME_GROUND },
      // A colony site's lack comes past home's reserve, so a mark that keeps nothing stays so.
      { good: STONE, upTo: COLONY_SITE_STONE, keep: 0 },
    ]);
  });
});

describe('a route under fire', () => {
  it('marks where its hull fell and owes no ship while no way is clear, until the fire lapses', () => {
    const { sim, ship } = routedWorld();
    sim.world.mut(ship, Health).hitpoints -= HULL_HIT;
    stepUntil(sim, ROUND_DUE_TICKS, () => (colonyState(sim)?.dangers.length ?? 0) > 0);
    expect(colonyState(sim)?.dangers).toHaveLength(1);
    // The strait runs the map's height: fire across all of it leaves no way round.
    editColony(sim).dangers = STRAIT_ACROSS.map((hy) => ({ at: { hx: STRAIT_MID_HX, hy }, seen: sim.tick }));
    removeVehicle(sim.world, ctxOf(sim), ship, 'destroyed');
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.route?.ship === null)).toBe(true);
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
    // Fire moves on: once its dangers lapse the route owes a ship again.
    for (const danger of editColony(sim).dangers) danger.seen = sim.tick - DANGER_LAPSED_TICKS;
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonySmallShips(sim.world, ctxOf(sim), SEAT) > 0)).toBe(true);
    expect(colonyState(sim)?.dangers).toEqual([]);
  });
});

describe('an abandoned route', () => {
  it('lets go of the helpers seated on its ship, so the ship lies free at the colony', () => {
    const { sim, ship } = routedWorld();
    const trader = standingTrader(sim);
    const helpers = (): Entity[] =>
      vehiclePassengers(sim.world.get(ship, Vehicle))
        .map((seat) => seat.entity)
        .filter((e) => e !== trader);
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const atColony = (): boolean => {
      const { moored, mooring } = sim.world.get(ship, Vehicle);
      return (
        moored &&
        mooring !== null &&
        terrain.componentOf(terrain.nodeAt(mooring.hx, mooring.hy)) === colonyState(sim)?.land
      );
    };
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => atColony() && helpers().length > 0)).toBe(true);
    abandon(sim);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.route === null)).toBe(true);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => helpers().length === 0)).toBe(true);
  });

  it('sets down whoever rode its ship once the ship docks, when the colony is let go at sea', () => {
    const { sim, ship } = routedWorld();
    const seats = () => vehiclePassengers(sim.world.get(ship, Vehicle));
    // The trader and a helper at least, all inside, under way.
    const trader = standingTrader(sim);
    const atSea = (): boolean =>
      sim.world.has(ship, VehicleDrive) &&
      sim.world.get(trader, TradeRoute).current === COLONY_STOP &&
      seats().length > 1 &&
      seats().every((seat) => seat.inside);
    expect(stepUntil(sim, ROUND_DUE_TICKS, atSea)).toBe(true);
    abandon(sim);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.route === null)).toBe(true);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => seats().length === 0)).toBe(true);
    expect(sim.world.get(trader, Settler).jobType).toBe(CIVILIST);
  });
});
