import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  ComputerColony,
  Female,
  mapBriefOf,
  Position,
  Rider,
  Settler,
  SettlerNeeds,
  setStockAmount,
  Vehicle,
  VehicleStock,
  zoneOfNode,
} from '../../../../../src/components/index.js';
import { ONE } from '../../../../../src/core/fixed.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  nodeOfPosition,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../../src/systems/ai-shared/cadence.js';
import { colonyHeldShips, homeBuildings } from '../../../../../src/systems/ai-shared/home-roster.js';
import { seatBaseOf } from '../../../../../src/systems/computer-player/base.js';
import { abandonColony } from '../../../../../src/systems/computer-player/colony/abandon.js';
import { colonyEnv } from '../../../../../src/systems/computer-player/colony/env.js';
import { spareMen } from '../../../../../src/systems/computer-player/colony/party.js';
import { holdLoad } from '../../../../../src/systems/computer-player/colony/sea/cargo.js';
import { surveyColonySite } from '../../../../../src/systems/computer-player/colony/voyage/survey.js';
import { fittingOut, returning } from '../../../../../src/systems/computer-player/colony/voyage/voyage.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../../src/systems/computer-player/military/operations/landing.js';
import { seatNeedsShips } from '../../../../../src/systems/computer-player/sea-route.js';
import { isFighterJob } from '../../../../../src/systems/readviews/index.js';
import {
  BIG_SHIP,
  colonyContent,
  colonyIslands,
  colonyState,
  colonyWorld,
  editColony,
  FOOD,
  mooredShip,
  SHIP_AT,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { JOINERY_TYPE, SEAT, STOCK_TYPE, VIKING, WOOD } from '../../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
/** The failed voyages a seat gives one colony. */
const FAILURES_ALLOWED = 2;
/** Past one survey beat. */
const SURVEY_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const UNLOAD_TICKS = 4;
const DECISION_TICKS = COMPUTER_DECISION_INTERVAL_TICKS + 1;
const FIT_OUT_TICKS = minutesToTicks(21);
const LOAD_DUE_TICKS = minutesToTicks(8);
const SAIL_DUE_TICKS = minutesToTicks(6);
const UNLOAD_DUE_TICKS = minutesToTicks(6);
const PARTY_LEAST = 8;
const SHORE_DX = 8;
const SEED = 7;
const TRADE_SHIP_SEATS = 10;
const AFTER_SAVE_TICKS = minutesToTicks(4);
const SECOND_SHIP_AT = { x: 90, y: 100 };
/** A home warehouse site on the west island, south of the headquarters. */
const HOME_SITE_AT = { x: 72, y: 84 };
/** A joinery beside it. */
const JOINERY_AT = { x: 84, y: 84 };
/** The wood a colony's first store costs, by the fixture, both warehouse tiers it is raised through: the
 *  manifest's only wood. */
const STORE_BILL_WOOD = 4;

function freeShipsOf(sim: Simulation): Entity[] {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const home = terrain.componentOf(terrain.nodeAt(SHIP_AT.x - SHORE_DX, SHIP_AT.y));
  return freeShips({ world: sim.world, ctx, terrain, seat: SEAT }, home);
}

describe('a colony scouts its site', () => {
  it('takes the man hungry the least to the helm of its empty hold', () => {
    const sim = colonyWorld();
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined)).toBe(true);
    const men = spareMen(sim.world, ctxOf(sim), SEAT);
    const fed = men.at(-1);
    if (fed === undefined) throw new Error('no men');
    for (const e of men) if (e !== fed) sim.world.mut(e, SettlerNeeds).hunger = ONE;
    mooredShip(sim);
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim)?.phase === 'scouting')).toBe(true);
    expect(colonyState(sim)?.scout?.helm).toBe(fed);
  });

  it('sends a civilian helm round the site on a seat with no soldier, and home', () => {
    const sim = colonyWorld();
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined)).toBe(true);
    expect(seatNeedsShips(sim.world, ctxOf(sim), SEAT)).toBe(true);
    const ship = mooredShip(sim);
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim)?.phase === 'scouting')).toBe(true);
    expect(colonyHeldShips(sim.world, SEAT)).toEqual([ship]);
    const helm = colonyState(sim)?.scout?.helm;
    if (helm === undefined) throw new Error('no helm');
    expect(isFighterJob(sim.content, sim.world.get(helm, Settler).jobType)).toBe(false);
    let sailed = false;
    const done = stepUntil(sim, SCOUT_DUE_TICKS, () => {
      sailed ||= !sim.world.get(ship, Vehicle).moored;
      return colonyState(sim)?.phase === 'fittingOut';
    });
    expect(done).toBe(true);
    expect(sailed).toBe(true);
    expect(stepUntil(sim, UNLOAD_TICKS, () => !sim.world.has(helm, Rider))).toBe(true);
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const mooring = sim.world.get(ship, Vehicle).mooring;
    if (terrain === undefined || mooring === null) throw new Error('the ship did not moor');
    const home = terrain.componentOf(terrain.nodeAt(mooring.hx, mooring.hy));
    expect(freeShips({ world: sim.world, ctx, terrain, seat: SEAT }, home)).toEqual([]);
  });

  it('claims the second free ship for the colony and lets the scout ship go, or at the fit-out limit carries on in the first', () => {
    const scouted = () => {
      const sim = colonyWorld();
      stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
      const ship = mooredShip(sim);
      stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
      return { sim, ship };
    };
    const twoShips = scouted();
    const second = mooredShip(twoShips.sim, SMALL_SHIP, SECOND_SHIP_AT);
    stepUntil(twoShips.sim, DECISION_TICKS, () => colonyState(twoShips.sim)?.ship !== null);
    expect(colonyState(twoShips.sim)?.ship).toBe(second);
    expect(colonyState(twoShips.sim)?.scout).toBeNull();
    expect(colonyHeldShips(twoShips.sim.world, SEAT)).toEqual([second]);
    const oneShip = scouted();
    const { sim } = oneShip;
    expect(stepUntil(sim, FIT_OUT_TICKS, () => colonyState(sim)?.ship !== null)).toBe(true);
    expect(colonyState(sim)?.ship).toBe(oneShip.ship);
    expect(colonyState(sim)?.scout).toBeNull();
  });
});

/** The people of `list` standing on the east island. */
function ashoreEast(sim: Simulation, list: readonly Entity[]): Entity[] {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const land = colonyState(sim)?.land;
  return list.filter((e) => {
    const p = sim.world.tryGet(e, Position);
    if (p === undefined || terrain === undefined) return false;
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    return terrain.componentOf(terrain.nodeAt(hx, hy)) === land;
  });
}

describe('a colony sails', () => {
  it('takes one party and the manifest over the strait in a second small ship, kept for the trade route', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const first = mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, LOAD_DUE_TICKS, () => colonyState(sim)?.phase === 'sailing')).toBe(true);
    expect(colonyState(sim)?.scout).toBeNull();
    const people = colonyState(sim)?.people ?? [];
    expect(people.length).toBeGreaterThanOrEqual(PARTY_LEAST);
    expect(holdLoad(sim.world, ship)).toBeGreaterThan(0);
    const wanted = [...(sim.world.get(ship, VehicleStock).lines.values() ?? [])];
    expect(wanted.some((line) => line.wanted === 0)).toBe(false);
    expect(stepUntil(sim, SAIL_DUE_TICKS, () => colonyState(sim)?.phase === 'founding')).toBe(true);
    expect(stepUntil(sim, UNLOAD_DUE_TICKS, () => holdLoad(sim.world, ship) === 0)).toBe(true);
    expect(stepUntil(sim, UNLOAD_DUE_TICKS, () => (colonyState(sim)?.route?.ship ?? null) === ship)).toBe(
      true,
    );
    const riding = (): Entity[] =>
      sim.world.get(ship, Vehicle).passengers.flatMap((seat) => (seat === null ? [] : [seat.entity]));
    expect(stepUntil(sim, UNLOAD_TICKS, () => riding().length === 1)).toBe(true);
    const helm = riding()[0] as Entity;
    expect(sim.world.has(helm, Female)).toBe(false);
    const settlers = people.filter((e) => e !== helm);
    expect(stepUntil(sim, UNLOAD_TICKS, () => ashoreEast(sim, settlers).length === settlers.length)).toBe(
      true,
    );
    expect(colonyHeldShips(sim.world, SEAT)).toContain(ship);
    expect(sim.world.get(first, Vehicle).passengers.every((seat) => seat === null)).toBe(true);
    expect(freeShipsOf(sim)).toContain(first);
  });

  it('scouts in the small ship while the trade ship lies ready, and claims that one once home', () => {
    const sim = colonyWorld(SEED, colonyContent(true));
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const scout = mooredShip(sim);
    const trade = mooredShip(sim, BIG_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim)?.phase === 'scouting')).toBe(true);
    expect(colonyState(sim)?.scout?.ship).toBe(scout);
    expect(stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.ship === trade)).toBe(true);
  });

  it('carries the party in a trade ship that scouted, with no wait for another', () => {
    const sim = colonyWorld(SEED, colonyContent(true));
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const trade = mooredShip(sim, BIG_SHIP);
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim)?.scout?.ship === trade)).toBe(true);
    expect(stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.ship === trade)).toBe(true);
    expect(colonyState(sim)?.scout).toBeNull();
  });

  it('sends ten and the manifest in a trade ship and the rest in the scout ship, which sails home', () => {
    const sim = colonyWorld(SEED, colonyContent(true));
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const scout = mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    const trade = mooredShip(sim, BIG_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, LOAD_DUE_TICKS, () => colonyState(sim)?.phase === 'sailing')).toBe(true);
    expect(colonyState(sim)?.ship).toBe(trade);
    const people = [...(colonyState(sim)?.people ?? [])];
    const rest = [...(colonyState(sim)?.rest ?? [])];
    expect(people).toHaveLength(TRADE_SHIP_SEATS);
    expect(rest.length).toBeGreaterThan(0);
    const helm = rest[0] as Entity;
    expect(sim.world.has(helm, Female)).toBe(false);
    expect(stepUntil(sim, SAIL_DUE_TICKS, () => colonyState(sim)?.scout === null)).toBe(true);
    expect(ashoreEast(sim, rest.slice(1))).toHaveLength(rest.length - 1);
    expect(colonyHeldShips(sim.world, SEAT)).toEqual([trade]);
    expect(stepUntil(sim, UNLOAD_TICKS, () => !sim.world.has(helm, Rider))).toBe(true);
    expect(ashoreEast(sim, [helm])).toEqual([]);
    expect(freeShipsOf(sim)).toContain(scout);
  });

  it('comes back from a save at sea exactly as it would have gone on', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    stepUntil(sim, LOAD_DUE_TICKS, () => colonyState(sim)?.phase === 'sailing');
    stepUntil(sim, LOAD_DUE_TICKS, () => !sim.world.get(ship, Vehicle).moored);
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: colonyContent(), map: colonyIslands() });
    expect(colonyState(copy)?.phase).toBe('sailing');
    expect(copy.hashState()).toBe(sim.hashState());
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(colonyState(copy)?.phase).toBe('running');
    expect(copy.hashState()).toBe(sim.hashState());
  });
});

describe('a failed voyage', () => {
  /** The seat's colony back home after `failures` failed voyages, with `ship` claimed for the party or
   *  none. */
  function failedOnce(ship: 'claimed' | 'none', failures = 1) {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const live = editColony(sim);
    live.phase = 'returning';
    live.failures = failures;
    live.ship = ship === 'claimed' ? mooredShip(sim) : null;
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (ctx.terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    const env = { world: sim.world, ctx, terrain: ctx.terrain, seat: SEAT, carrier };
    const colony = sim.world.get(carrier, ComputerColony).colonies[0];
    if (colony === undefined) throw new Error('setup: no colony');
    returning(colonyEnv(env, colony), colony);
    return { retryAt: sim.world.get(carrier, ComputerColony).retryAt, tick: ctx.tick, phase: colony.phase };
  }

  it('holds the next one while the stores refill once it took a carrying ship', () => {
    const { retryAt, tick } = failedOnce('claimed');
    expect(retryAt).toBeGreaterThan(tick);
  });

  it('lets the next scouting go at once when it turned back before that', () => {
    expect(failedOnce('none').retryAt).toBe(0);
  });

  it('gives the colony up at its last allowed failure and holds the next voyage', () => {
    const { retryAt, tick, phase } = failedOnce('none', FAILURES_ALLOWED);
    expect(phase).toBe('abandoned');
    expect(retryAt).toBeGreaterThan(tick);
  });

  it('keeps the sites it gave up on once it holds no colony, and chooses none of them again', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const brief = mapBriefOf(sim.world);
    const carrier = aiControlEntity(sim.world, SEAT);
    const ctx = ctxOf(sim);
    if (brief === null || carrier === null || ctx.terrain === undefined) throw new Error('setup: no seat');
    const rejected = sim.world.mut(carrier, ComputerColony).rejected;
    for (let site = surveyColonySite(sim.world, ctx, SEAT, rejected); site !== null; ) {
      rejected.push(zoneOfNode(brief, site.centre.hx, site.centre.hy));
      site = surveyColonySite(sim.world, ctx, SEAT, rejected);
    }
    const given = editColony(sim);
    given.phase = 'returning';
    given.failures = 1;
    returning(colonyEnv({ world: sim.world, ctx, terrain: ctx.terrain, seat: SEAT, carrier }, given), given);
    expect(colonyState(sim)).toBeUndefined();
    stepUntil(sim, SURVEY_TICKS, () => false);
    expect(colonyState(sim)).toBeUndefined();
  });
});

describe('a seat whose colonies are all lost', () => {
  it('chooses a site on another land once its retry has passed', () => {
    const sim = colonyWorld(SEED, colonyContent(), [], true);
    expect(stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined)).toBe(true);
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    const lost = colonyState(sim);
    if (ctx.terrain === undefined || carrier === null || lost === undefined)
      throw new Error('setup: no colony');
    abandonColony(colonyEnv({ world: sim.world, ctx, terrain: ctx.terrain, seat: SEAT, carrier }, lost));
    const retryAt = sim.world.get(carrier, ComputerColony).retryAt;
    expect(retryAt).toBeGreaterThan(sim.tick);
    const chosen = (): boolean => colonyState(sim, 1) !== undefined;
    expect(stepUntil(sim, SURVEY_TICKS, chosen)).toBe(false);
    sim.world.mut(carrier, ComputerColony).retryAt = sim.tick;
    expect(stepUntil(sim, SURVEY_TICKS, chosen)).toBe(true);
    expect(colonyState(sim, 1)?.land).not.toBe(lost.land);
  });
});

describe('a colony fitting out', () => {
  /** The phase after one fitting-out decision beside a new home warehouse site holding `siteWood` of its
   *  bill, with `storeWood` in the headquarters, `shelfWood` kept for its recipe by a built joinery beside it
   *  and no wood anywhere else at home. With `food`, home holds that much food alone, in the headquarters. */
  function fitOutBesideSite(
    storeWood: number,
    siteWood: number,
    shelfWood = 0,
    food?: number,
  ): string | undefined {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const before = new Set(homeBuildings(sim.world, ctxOf(sim), SEAT));
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      ...HOME_SITE_AT,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: true,
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: JOINERY_TYPE,
      ...JOINERY_AT,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: false,
    });
    sim.step();
    const base = seatBaseOf(sim.world, ctxOf(sim), SEAT);
    const joinery = homeBuildings(sim.world, ctxOf(sim), SEAT).find(
      (e) => !before.has(e) && sim.world.get(e, Building).buildingType === JOINERY_TYPE,
    );
    if (joinery === undefined) throw new Error('setup: no joinery');
    for (const e of homeBuildings(sim.world, ctxOf(sim), SEAT))
      setStockAmount(
        sim.world,
        e,
        WOOD,
        e === joinery ? shelfWood : !before.has(e) ? siteWood : e === base ? storeWood : 0,
      );
    if (food !== undefined)
      for (const e of homeBuildings(sim.world, ctxOf(sim), SEAT))
        setStockAmount(sim.world, e, FOOD, e === base ? food : 0);
    const live = editColony(sim);
    live.phase = 'fittingOut';
    live.since = sim.tick;
    live.ship = mooredShip(sim);
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (ctx.terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    const env = { world: sim.world, ctx, terrain: ctx.terrain, seat: SEAT, carrier };
    const colony = sim.world.get(carrier, ComputerColony).colonies[0];
    if (colony === undefined) throw new Error('setup: no colony');
    fittingOut(colonyEnv(env, colony), colony);
    return colonyState(sim)?.phase;
  }

  it("waits while the manifest's goods lie only in home's sites, which spend them", () => {
    // The manifest's wood lies in the new site alone: all the store's bill, which the site spends itself.
    expect(fitOutBesideSite(0, STORE_BILL_WOOD)).toBe('fittingOut');
  });

  it("waits while the manifest's goods lie only in a workshop's recipe input, which no hand fetches", () => {
    expect(fitOutBesideSite(0, 0, STORE_BILL_WOOD)).toBe('fittingOut');
  });

  it('loads what home stores while its sites still lack the same goods, so open sites never hold the party', () => {
    // The headquarters holds the manifest's wood, and the empty site lacks as much again.
    expect(fitOutBesideSite(STORE_BILL_WOOD, 0)).toBe('loading');
  });

  it("sails with the store's bill without waiting for the party's food", () => {
    expect(fitOutBesideSite(STORE_BILL_WOOD, 0, 0, 0)).toBe('loading');
  });
});
