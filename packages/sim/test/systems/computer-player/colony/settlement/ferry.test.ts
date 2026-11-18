import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  Health,
  JobAssignment,
  Resource,
  Rider,
  Settler,
  Vehicle,
} from '../../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../../src/core/commands/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import type { Simulation } from '../../../../../src/index.js';
import { nodeManhattan } from '../../../../../src/nav/halfcell.js';
import { everySettlerOf, homeSettlers } from '../../../../../src/systems/ai-shared/home-roster.js';
import { isAllocatableMan } from '../../../../../src/systems/ai-shared/workforce/pool.js';
import { runFerry } from '../../../../../src/systems/computer-player/colony/settlement/ferry.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { SHIP_SAIL_TIMEOUT_TICKS } from '../../../../../src/systems/computer-player/sea-ships.js';
import { attachToVehicle, boardRider } from '../../../../../src/systems/vehicles/crew.js';
import { mooringSpotsOf } from '../../../../../src/systems/vehicles/dock.js';
import {
  ARMORY_TYPE,
  blankColony,
  colonySettlersOf,
  colonyState,
  colonyWorld,
  editColony,
  looseColonyEnv,
  mooredShip,
  overflowContent,
  SHIP_AT,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { idleBuilders, routedWorld, runningWorld } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { BUILDER, CIVILIST, SEAT, STOCK_TYPE, VIKING } from '../../support.js';

const HOME_DUE_TICKS = minutesToTicks(45);

/** Who stands on the colony or rides for it. */
const colonyPeople = (sim: Simulation): number => {
  const home = new Set(homeSettlers(sim.world, ctxOf(sim), SEAT));
  return everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e)).length;
};

const ROUND_DUE_TICKS = minutesToTicks(30);
/** The builders a colony keeps at rest once nothing is left to raise. */
const BUILDERS_KEPT = 2;
/** Off the colony's shore: a ship made here lies moored on the east island. */
const COLONY_SHORE_AT = { x: 138, y: 60 };
/** A store of the seat's on the east island, and an armory with its armorer's seat open. */
const COLONY_STORE_AT = { x: 180, y: 60 };
const COLONY_ARMORY_AT = { x: 180, y: 80 };
/** Where a man of home stands before he is seated on the ship. */
const HOME_MAN_AT = { x: 40, y: 60 };
/** How far apart, in half-cell nodes, the shores a refused ship tries lie at the least. */
const SHORE_SPACING_NODES = 10;

/** A ship of the seat with a man of home seated aboard, at `at`. */
function shipWithRider(sim: ReturnType<typeof colonyWorld>, at: { readonly x: number; readonly y: number }) {
  const ship = mooredShip(sim, SMALL_SHIP, at);
  const before = new Set(everySettlerOf(sim.world, SEAT));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, ...HOME_MAN_AT, tribe: VIKING, owner: SEAT });
  sim.step();
  const rider = everySettlerOf(sim.world, SEAT).find((e) => !before.has(e));
  const ctx = ctxOf(sim);
  if (rider === undefined) throw new Error('setup: no rider');
  attachToVehicle(sim.world, ctx, { kind: 'attachToVehicle', entity: rider, vehicle: ship });
  boardRider(sim.world, rider, ship);
  return { ship, rider };
}

/** Where `orders` dock the ship. */
function dockedAt(orders: readonly PlayerCommand[]): { readonly hx: number; readonly hy: number } {
  const dock = orders.find((order) => order.kind === 'dockVehicle');
  if (dock?.kind !== 'dockVehicle') throw new Error('no dock order');
  return { hx: dock.x, hy: dock.y };
}

describe('a colony ferry with no helm', () => {
  it('lands the garrison it carries at the colony and keeps it on the colony list', () => {
    const sim = colonyWorld();
    const { ship, rider } = shipWithRider(sim, COLONY_SHORE_AT);
    const ctx = ctxOf(sim);
    const mooring = sim.world.get(ship, Vehicle).mooring;
    if (ctx.terrain === undefined || mooring === null) throw new Error('setup');
    const land = ctx.terrain.componentOf(ctx.terrain.nodeAt(mooring.hx, mooring.hy));
    const hull = sim.world.get(ship, Health).hitpoints;
    const colony = blankColony(land, {
      garrison: [rider],
      ferry: { ship, side: 'colony', leg: 'sail', since: 0, helm: null, hull, tried: [] },
    });

    const orders = runFerry(looseColonyEnv(sim, colony), colony);

    expect(colony.ferry).toBeNull();
    expect(orders.map((order) => order.kind)).toContain('unloadPeople');
    expect(colony.garrison).toEqual([rider]);
  });
});

describe('a colony ferry under wild attack', () => {
  it('takes neither hands nor craftsmen over while wild animals keep attacking the colony, and does once they stop', () => {
    const sim = colonyWorld(undefined, overflowContent());
    for (const [buildingType, at] of [
      [STOCK_TYPE, COLONY_STORE_AT],
      [ARMORY_TYPE, COLONY_ARMORY_AT],
    ] as const)
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        ...at,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction: false,
      });
    sim.step();
    mooredShip(sim);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    // Held by the seat, so the store and the armory count as the colony's and the armorer's seat is owed.
    const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE_AT.x, COLONY_STORE_AT.y));
    const held = blankColony(land, {
      shore: { hx: COLONY_SHORE_AT.x, hy: COLONY_SHORE_AT.y },
      berth: { hx: SHIP_AT.x, hy: SHIP_AT.y },
      wild: { since: sim.tick, seen: sim.tick },
    });
    sim.world.add(carrier, ComputerColony, { colonies: [held], rejected: [], retryAt: 0 });
    const colony = editColony(sim);
    const env = looseColonyEnv(sim, colony);

    runFerry(env, colony);
    expect(colony.ferry).toBeNull();
    colony.wild = null;
    runFerry(env, colony);
    expect(colony.ferry).not.toBeNull();
  });
});

describe('a colony ferry reaching a colony given up meanwhile', () => {
  it('sets nobody ashore there and keeps its riders aboard for home', () => {
    const sim = colonyWorld();
    const { ship, rider: helm } = shipWithRider(sim, COLONY_SHORE_AT);
    const before = new Set(everySettlerOf(sim.world, SEAT));
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, ...HOME_MAN_AT, tribe: VIKING, owner: SEAT });
    sim.step();
    const rider = everySettlerOf(sim.world, SEAT).find((e) => !before.has(e));
    const ctx = ctxOf(sim);
    const mooring = sim.world.get(ship, Vehicle).mooring;
    if (rider === undefined || ctx.terrain === undefined || mooring === null) throw new Error('setup');
    attachToVehicle(sim.world, ctx, { kind: 'attachToVehicle', entity: rider, vehicle: ship });
    boardRider(sim.world, rider, ship);
    const land = ctx.terrain.componentOf(ctx.terrain.nodeAt(mooring.hx, mooring.hy));
    const hull = sim.world.get(ship, Health).hitpoints;
    const colony = blankColony(land, {
      phase: 'abandoned',
      garrison: [rider],
      ferry: { ship, side: 'colony', leg: 'sail', since: 0, helm, hull, tried: [] },
    });

    const orders = runFerry(looseColonyEnv(sim, colony), colony);

    expect(orders.map((order) => order.kind)).not.toContain('detachFromVehicle');
    expect(colony.ferry?.leg).toBe('board');
  });
});

describe('a colony ferry refused its dock', () => {
  it('tries a shore clear of each it was refused at this leg, not the same one again', () => {
    const sim = colonyWorld();
    const { ship } = shipWithRider(sim, COLONY_SHORE_AT);
    const ctx = ctxOf(sim);
    const shore = sim.world.get(ship, Vehicle).mooring;
    if (ctx.terrain === undefined || shore === null) throw new Error('setup');
    const land = ctx.terrain.componentOf(ctx.terrain.nodeAt(shore.hx, shore.hy));
    // Lying still off the colony's shore, unmoored: each decision reads as one more refused dock.
    const state = sim.world.mut(ship, Vehicle);
    state.moored = false;
    state.mooring = null;
    const hull = sim.world.get(ship, Health).hitpoints;
    const colony = blankColony(land, {
      shore: { hx: shore.hx, hy: shore.hy },
      ferry: { ship, side: 'colony', leg: 'sail', since: 0, helm: null, hull, tried: [] },
    });
    const env = looseColonyEnv(sim, colony);

    const first = dockedAt(runFerry(env, colony));
    const second = dockedAt(runFerry(env, colony));

    expect(nodeManhattan(first, shore)).toBeGreaterThanOrEqual(SHORE_SPACING_NODES);
    expect(nodeManhattan(second, shore)).toBeGreaterThanOrEqual(SHORE_SPACING_NODES);
    expect(nodeManhattan(second, first)).toBeGreaterThanOrEqual(SHORE_SPACING_NODES);
  });

  it('sails its riders home once every shore of the colony refused it past the crossing time', () => {
    const sim = colonyWorld();
    const { ship, rider } = shipWithRider(sim, COLONY_SHORE_AT);
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const shore = sim.world.get(ship, Vehicle).mooring;
    const spots = terrain === undefined ? null : mooringSpotsOf(sim.world, ctx, terrain, ship);
    if (terrain === undefined || shore === null || spots === null) throw new Error('setup');
    const land = terrain.componentOf(terrain.nodeAt(shore.hx, shore.hy));
    const tried = [...spots.spots]
      .filter((node) => terrain.componentOf(node) === land)
      .map((node) => ({ hx: terrain.coordsOf(node).x, hy: terrain.coordsOf(node).y }));
    const state = sim.world.mut(ship, Vehicle);
    state.moored = false;
    state.mooring = null;
    const hull = sim.world.get(ship, Health).hitpoints;
    const berth = { hx: SHIP_AT.x, hy: SHIP_AT.y };
    const since = sim.tick - SHIP_SAIL_TIMEOUT_TICKS;
    const colony = blankColony(land, {
      shore: { hx: shore.hx, hy: shore.hy },
      berth,
      rest: [rider],
      ferry: { ship, side: 'colony', leg: 'sail', since, helm: null, hull, tried },
    });

    const orders = runFerry(looseColonyEnv(sim, colony), colony);

    expect(colony.ferry?.side).toBe('home');
    expect(dockedAt(orders)).toEqual(berth);
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
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    // The men bound to a workplace: a flag gatherer whose patch runs dry has no work left either.
    const posted = colonySettlersOf(sim).filter(
      (e) => sim.world.has(e, JobAssignment) && isAllocatableMan(sim.world, ctxOf(sim), e),
    );
    expect(posted.length).toBeGreaterThan(0);
    const { idle, husband } = idleBuilders(sim);
    const landed = (): Entity[] => {
      const home = homeSettlers(sim.world, ctxOf(sim), SEAT);
      return idle.filter((e) => home.includes(e) && !sim.world.has(e, Rider));
    };
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => landed().length > 0)).toBe(true);
    expect(landed().map((e) => sim.world.get(e, Settler).jobType)).toEqual(landed().map(() => CIVILIST));
    stepUntil(sim, ROUND_DUE_TICKS, () => false);
    // The colony keeps a pair of builders at rest, which a fresh idle man may fill, and a fresh man it gave
    // another post stays at it.
    expect(landed()).not.toContain(husband);
    const colony = colonySettlersOf(sim);
    const reposted = idle.filter(
      (e) => e !== husband && colony.includes(e) && sim.world.get(e, Settler).jobType !== BUILDER,
    );
    expect(landed().length).toBeGreaterThanOrEqual(idle.length - 1 - BUILDERS_KEPT - reposted.length);
    expect(colony).toContain(husband);
    expect(posted.filter((e) => sim.world.isAlive(e) && !colony.includes(e))).toEqual([]);
  });

  it('sails men home once the colony has no work left', () => {
    const { sim } = runningWorld('barracks');
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const colonists = everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e));
    for (const e of sim.world.canonicalQuery(Resource)) sim.world.destroy(e);
    const back = (): Entity[] => {
      const now = new Set(homeSettlers(sim.world, ctxOf(sim), SEAT));
      return colonists.filter((e) => now.has(e));
    };
    expect(stepUntil(sim, HOME_DUE_TICKS, () => back().length > 0)).toBe(true);
  });
});
