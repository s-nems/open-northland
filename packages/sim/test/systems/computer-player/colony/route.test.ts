import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  Female,
  Health,
  Marriage,
  Rider,
  Settler,
  TradeRoute,
  TradeShip,
  Vehicle,
  VehicleStock,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import {
  colonyHeldShips,
  everyBuildingOf,
  everySettlerOf,
  homeBuildings,
  homeSettlers,
} from '../../../../src/systems/ai-shared/home-roster.js';
import { isAllocatableMan } from '../../../../src/systems/ai-shared/workforce/pool.js';
import { seatBaseOf } from '../../../../src/systems/computer-player/base.js';
import { colonySmallShips } from '../../../../src/systems/computer-player/colony/fleet.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { strandedShip } from '../../../../src/systems/computer-player/sea-route.js';
import { setAiControl } from '../../../../src/systems/orders/ai.js';
import { isTraderJob } from '../../../../src/systems/readviews/index.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { stockAtBuildings } from '../../../../src/systems/stores/index.js';
import { removeVehicle } from '../../../../src/systems/vehicles/index.js';
import {
  colonyBuildingsOf,
  colonyContent,
  colonyIslands,
  colonySettlersOf,
  colonyState,
  colonyWorld,
  editColony,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { BUILDER, CIVILIST, MUD, SEAT, STONE, UNARMED, VIKING, WOMAN } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const ROUTE_DUE_TICKS = minutesToTicks(20);
const LEG_DUE_TICKS = minutesToTicks(8);
const ROUND_DUE_TICKS = minutesToTicks(30);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const THIRD_SHIP_AT = { x: 90, y: 20 };
/** Off the colony's shore. */
const STRAY_AT = { x: 138, y: 60 };
const SITE_NEAR = 4;
const HULL_HIT = 100;
const STRAIT_MID_HX = 114;
const STRAIT_ACROSS = [30, 60, 90];
const DANGER_LAPSED_TICKS = minutesToTicks(40);
const ENEMY = 5;
/** Idle builders few enough that every one is past the colony's work. */
const IDLE_MEN = 8;
const IDLE_STEP = 2;

/** The colony's trader once the route stands: a trader with the ship pinned and both stops on its route. */
function routeTrader(sim: Simulation): Entity | null {
  const route = colonyState(sim)?.route;
  const trader = route?.trader ?? null;
  if (trader === null || route?.ship == null) return null;
  const pinned = sim.world.tryGet(trader, TradeShip)?.vehicle === route.ship;
  return pinned && (sim.world.tryGet(trader, TradeRoute)?.stops.length ?? 0) === 2 ? trader : null;
}

/** A colony landed and its trade route standing. */
function routedWorld(): { readonly sim: Simulation; readonly ship: Entity; readonly scout: Entity } {
  const sim = colonyWorld();
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  const scout = mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, ROUTE_DUE_TICKS, () => routeTrader(sim) !== null)) throw new Error('setup: no route');
  return { sim, ship, scout };
}

/** The land under the seat's headquarters. */
function homeLandOfSeat(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const base = seatBaseOf(sim.world, ctx, SEAT);
  if (terrain === undefined || base === null) throw new Error('setup: no base');
  return terrain.componentOf(interactionCell(sim.world, ctx, terrain, base));
}

function aboard(sim: Simulation, ship: Entity, good: number): number {
  return sim.world.tryGet(ship, VehicleStock)?.lines.get(good)?.current ?? 0;
}

/** Who stands on the colony or rides for it. */
const colonyPeople = (sim: Simulation): number => {
  const home = new Set(homeSettlers(sim.world, ctxOf(sim), SEAT));
  return everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e)).length;
};

describe('a colony trade route', () => {
  it('pins the colony ship to a home trader between two settlements, and moves goods both ways', () => {
    const { sim, ship } = routedWorld();
    const trader = routeTrader(sim) as Entity;
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
    let stoneOut = 0;
    const both = stepUntil(sim, ROUND_DUE_TICKS, () => {
      stoneOut = Math.max(stoneOut, aboard(sim, ship, STONE));
      return colonyHolds(MUD) > 0 && stoneOut > 0 && (colonyState(sim)?.delivered ?? null) !== null;
    });
    expect(both).toBe(true);
    expect(marks()[0]?.imports.some((m) => m.good === STONE)).toBe(true);
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

describe('a colony ferry', () => {
  it('brings the hands a colony lacks over on a free ship', () => {
    const { sim } = routedWorld();
    const before = colonyPeople(sim);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyPeople(sim) > before)).toBe(true);
  });

  it("sends men with no work left home as civilians, but keeps its posted men and a wife's husband", () => {
    const { sim } = routedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const posted = colonySettlersOf(sim).filter((e) => {
      const job = sim.world.get(e, Settler).jobType;
      return job !== BUILDER && job !== CIVILIST && isAllocatableMan(sim.world, ctxOf(sim), e);
    });
    expect(posted.length).toBeGreaterThan(0);
    const before = new Set(everySettlerOf(sim.world, SEAT));
    const spawn = (jobType: number, x: number): void =>
      sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y: site.hy, tribe: VIKING, owner: SEAT });
    for (let i = 0; i < IDLE_MEN; i++) spawn(BUILDER, site.hx + IDLE_STEP * i);
    spawn(WOMAN, site.hx);
    sim.step();
    const fresh = colonySettlersOf(sim).filter((e) => !before.has(e));
    const wife = fresh.find((e) => sim.world.has(e, Female));
    const idle = fresh.filter((e) => !sim.world.has(e, Female));
    const husband = idle[0];
    if (wife === undefined || husband === undefined) throw new Error('setup: no couple on the colony');
    sim.world.add(wife, Marriage, { spouse: husband, child: null });
    sim.world.add(husband, Marriage, { spouse: wife, child: null });
    const landed = (): Entity[] => {
      const home = homeSettlers(sim.world, ctxOf(sim), SEAT);
      return idle.filter((e) => home.includes(e) && !sim.world.has(e, Rider));
    };
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => landed().length > 0)).toBe(true);
    expect(landed().map((e) => sim.world.get(e, Settler).jobType)).toEqual(landed().map(() => CIVILIST));
    stepUntil(sim, ROUND_DUE_TICKS, () => false);
    expect(landed()).toEqual(idle.filter((e) => e !== husband));
    const colony = colonySettlersOf(sim);
    expect(colony).toContain(husband);
    expect(posted.filter((e) => sim.world.isAlive(e) && !colony.includes(e))).toEqual([]);
  });
});

describe('a ship left without a helm', () => {
  it('is brought home from the colony by a man of the colony, who steps off there', () => {
    const { sim } = routedWorld();
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const stray = mooredShip(sim, SMALL_SHIP, STRAY_AT);
    const land = colonyState(sim)?.land;
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const mooring = sim.world.get(stray, Vehicle).mooring;
    if (land === undefined || terrain === undefined || mooring === null) throw new Error('setup: unmoored');
    expect(terrain.componentOf(terrain.nodeAt(mooring.hx, mooring.hy))).toBe(land);
    const env = { world: sim.world, ctx, terrain, seat: SEAT };
    const home = homeLandOfSeat(sim);
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => freeShips(env, home).includes(stray))).toBe(true);
  });

  it('counts out of the fleet once it lies adrift with nobody aboard', () => {
    const sim = colonyWorld();
    sim.step();
    const ship = mooredShip(sim);
    expect(strandedShip(sim.world, ctxOf(sim), SEAT, ship)).toBe(false);
    sim.world.mut(ship, Vehicle).moored = false;
    expect(strandedShip(sim.world, ctxOf(sim), SEAT, ship)).toBe(true);
  });
});

describe('a colony toggle turned off', () => {
  it('hands the colony back to the whole seat and stays off while the toggle does', () => {
    const { sim } = routedWorld();
    const carrier = aiControlEntity(sim.world, SEAT) as Entity;
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT).length).toBeLessThan(
      everySettlerOf(sim.world, SEAT).length,
    );
    const modules = { ...sim.world.get(carrier, AiControl).modules, houseBuild: false };
    setAiControl(sim.world, ctxOf(sim), { kind: 'setAiControl', player: SEAT, enabled: true, modules });
    expect(colonyState(sim)).toBeUndefined();
    expect(colonyHeldShips(sim.world, SEAT)).toEqual([]);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).toEqual(everySettlerOf(sim.world, SEAT));
    expect(homeBuildings(sim.world, ctxOf(sim), SEAT)).toEqual(everyBuildingOf(sim.world, SEAT));
    stepUntil(sim, AFTER_SAVE_TICKS, () => false);
    expect(colonyState(sim)).toBeUndefined();
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

describe('an overrun colony', () => {
  it('is abandoned with no store standing and an enemy in sight, lets its route go and its survivors sail home', () => {
    const { sim } = routedWorld();
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    const trader = routeTrader(sim) as Entity;
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const settlers = everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e) && e !== trader);
    for (const e of [...colonyBuildingsOf(sim)]) sim.world.destroy(e);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: UNARMED,
      x: site.hx + SITE_NEAR,
      y: site.hy,
      tribe: VIKING,
      owner: ENEMY,
    });
    expect(stepUntil(sim, LEG_DUE_TICKS, () => colonyState(sim)?.phase === 'abandoned')).toBe(true);
    expect(colonyState(sim)?.people).toEqual([]);
    expect(stepUntil(sim, LEG_DUE_TICKS, () => sim.world.get(trader, Settler).jobType === CIVILIST)).toBe(
      true,
    );
    expect(colonyState(sim)?.route).toBeNull();
    const back = (): boolean =>
      homeSettlers(sim.world, ctxOf(sim), SEAT).some((e) => settlers.includes(e) && e !== trader);
    expect(stepUntil(sim, ROUND_DUE_TICKS, back)).toBe(true);
    const placed = colonyState(sim)?.builds.filter((b) => b.placed).length;
    stepUntil(sim, AFTER_SAVE_TICKS, () => false);
    expect(colonyState(sim)?.builds.filter((b) => b.placed).length).toBe(placed);
  });
});
