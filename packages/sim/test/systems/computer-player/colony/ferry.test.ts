import { describe, expect, it } from 'vitest';
import { Health, Vehicle } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import { nodeManhattan } from '../../../../src/nav/halfcell.js';
import { everySettlerOf } from '../../../../src/systems/ai-shared/home-roster.js';
import { runFerry } from '../../../../src/systems/computer-player/colony/ferry.js';
import { LANDING_SAIL_TIMEOUT_TICKS } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { attachToVehicle, boardRider } from '../../../../src/systems/vehicles/crew.js';
import { mooringSpotsOf } from '../../../../src/systems/vehicles/dock.js';
import {
  blankColony,
  colonyWorld,
  looseColonyEnv,
  mooredShip,
  SHIP_AT,
  SMALL_SHIP,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, SEAT, VIKING } from '../support.js';

/** Off the colony's shore: a ship made here lies moored on the east island. */
const COLONY_SHORE_AT = { x: 138, y: 60 };
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
    const since = sim.tick - LANDING_SAIL_TIMEOUT_TICKS;
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
