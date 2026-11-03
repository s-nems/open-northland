import { describe, expect, it } from 'vitest';
import {
  Building,
  Female,
  JobAssignment,
  Position,
  Resource,
  Rider,
  Settler,
  SettlerNeeds,
  UnderConstruction,
  Vehicle,
  VehicleStock,
} from '../../../../src/components/index.js';
import { ONE } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  nodeOfPosition,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../src/systems/ai-shared/cadence.js';
import { colonyHeldShips, homeBuildings } from '../../../../src/systems/ai-shared/home-roster.js';
import { holdLoad } from '../../../../src/systems/computer-player/colony/cargo.js';
import { spareMen } from '../../../../src/systems/computer-player/colony/people.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { seatNeedsShips } from '../../../../src/systems/computer-player/sea-route.js';
import { addFishSwarms } from '../../../../src/systems/economy/fish.js';
import { liveWorkFlag } from '../../../../src/systems/economy/work-flag.js';
import { isFighterJob, isFisherJob } from '../../../../src/systems/readviews/index.js';
import {
  BIG_SHIP,
  colonyBuildingsOf,
  colonyContent,
  colonyIslands,
  colonySettlersOf,
  colonyState,
  colonyWorld,
  editColony,
  fishingColonyContent,
  huntingColonyContent,
  mooredShip,
  SHIP_AT,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { BUILDER, FARM_TYPE, HOME_TOP_TYPE, HOME_TYPE, HUNTER, SEAT, STOCK_TOP_TYPE } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
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
const FOUND_DUE_TICKS = minutesToTicks(16);
const GATHER_DUE_TICKS = minutesToTicks(4);
const LADDER_DUE_TICKS = minutesToTicks(14);
const FARM_ID = 'work_farm_00';
const HOMES_DUE_TICKS = minutesToTicks(20);
/** The fixture's home chain, base tier to top. */
const HOME_MID_TYPE = HOME_TYPE + 1;
const HOME_TYPES = [HOME_TYPE, HOME_MID_TYPE, HOME_TOP_TYPE];
const BUILDERS_AT_REST = 2;
const TRADE_SHIP_SEATS = 10;
const AFTER_SAVE_TICKS = minutesToTicks(4);
const SECOND_SHIP_AT = { x: 90, y: 100 };
/** A swarm in the strait off the east island's shore, and its fish. */
const EAST_FISH_AT = { hx: 134, hy: 60 };
const FISH_IN_SWARM = 40;

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

  it('claims the second free ship for the colony, or at the fit-out limit carries on in the first', () => {
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
    expect(colonyState(twoShips.sim)?.scout?.ship).toBe(twoShips.ship);
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

  it('founds a level-3 store on the far land, houses its families and sets gatherers to work there', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const ctx = ctxOf(sim);
    const away = colonyBuildingsOf(sim);
    const standing = away.filter((e) => !sim.world.has(e, UnderConstruction));
    expect(standing.map((e) => sim.world.get(e, Building).buildingType)).toContain(STOCK_TOP_TYPE);
    const left = (): number => {
      let units = 0;
      for (const e of sim.world.query(Resource)) units += sim.world.get(e, Resource).remaining;
      return units;
    };
    const before = left();
    expect(stepUntil(sim, GATHER_DUE_TICKS, () => left() < before)).toBe(true);
    expect(homeBuildings(sim.world, ctx, SEAT).some((e) => away.includes(e))).toBe(false);
  });

  it('raises its homes straight at the top tier the tribe has', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const homes = (): number[] =>
      colonyBuildingsOf(sim)
        .map((e) => sim.world.get(e, Building).buildingType)
        .filter((type) => HOME_TYPES.includes(type));
    expect(stepUntil(sim, FOUND_DUE_TICKS + HOMES_DUE_TICKS, () => homes().length > 0)).toBe(true);
    expect(homes().every((type) => type === HOME_TOP_TYPE)).toBe(true);
  });

  it('raises a farm on the colony once the fishers do not meet its hunger', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const farmRow = (): boolean => colonyState(sim)?.builds.some((b) => b.building === FARM_ID) === true;
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    expect(farmRow()).toBe(false);
    expect(stepUntil(sim, LADDER_DUE_TICKS, farmRow)).toBe(true);
    sim.step();
    const farm = colonyBuildingsOf(sim).find((e) => sim.world.get(e, Building).buildingType === FARM_TYPE);
    expect(farm).toBeDefined();
  });

  it('sets its builders past a pair digging once nothing is left to raise', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const builders = (): number => {
      return colonySettlersOf(sim).filter(
        (e) => !sim.world.has(e, Rider) && sim.world.get(e, Settler).jobType === BUILDER,
      ).length;
    };
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    for (const e of [...colonyBuildingsOf(sim)])
      if (sim.world.has(e, UnderConstruction)) sim.world.destroy(e);
    for (const build of editColony(sim).builds) build.placed = true;
    expect(stepUntil(sim, GATHER_DUE_TICKS, () => builders() <= BUILDERS_AT_REST)).toBe(true);
  });

  it('puts no man on the hunter seat where no game is left, and sets him to other work', () => {
    const sim = colonyWorld(SEED, huntingColonyContent());
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    stepUntil(sim, GATHER_DUE_TICKS, () => false);
    expect(colonySettlersOf(sim).filter((e) => sim.world.get(e, Settler).jobType === HUNTER)).toEqual([]);
  });

  it('sets its fishers by the shore with a flag of their own, not at the store, so each catch is set down there', () => {
    const sim = colonyWorld(SEED, fishingColonyContent());
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    addFishSwarms(sim.world, terrain, [{ ...EAST_FISH_AT, count: FISH_IN_SWARM, continent: 0 }]);
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const fishers = (): Entity[] => {
      const ctx = ctxOf(sim);
      return colonySettlersOf(sim).filter((e) => isFisherJob(ctx.content, sim.world.get(e, Settler).jobType));
    };
    expect(stepUntil(sim, GATHER_DUE_TICKS, () => fishers().length > 0)).toBe(true);
    for (const e of fishers()) {
      expect(sim.world.has(e, JobAssignment)).toBe(false);
      expect(liveWorkFlag(sim.world, e)).toBeDefined();
    }
  });
});
