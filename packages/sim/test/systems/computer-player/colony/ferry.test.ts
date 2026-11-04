import { describe, expect, it } from 'vitest';
import { Health, Vehicle } from '../../../../src/components/index.js';
import { everySettlerOf } from '../../../../src/systems/ai-shared/home-roster.js';
import { runFerry } from '../../../../src/systems/computer-player/colony/ferry.js';
import { attachToVehicle, boardRider } from '../../../../src/systems/vehicles/crew.js';
import {
  blankColony,
  colonyWorld,
  looseColonyEnv,
  mooredShip,
  SMALL_SHIP,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, SEAT, VIKING } from '../support.js';

/** Off the colony's shore: a ship made here lies moored on the east island. */
const COLONY_SHORE_AT = { x: 138, y: 60 };
/** Where a man of home stands before he is seated on the ship. */
const HOME_MAN_AT = { x: 40, y: 60 };

describe('a colony ferry with no helm', () => {
  it('lands the garrison it carries at the colony and keeps it on the colony list', () => {
    const sim = colonyWorld();
    const ship = mooredShip(sim, SMALL_SHIP, COLONY_SHORE_AT);
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
      garrison: [rider],
      ferry: { ship, side: 'colony', leg: 'sail', since: 0, helm: null, hull },
    });

    const orders = runFerry(looseColonyEnv(sim, colony), colony);

    expect(colony.ferry).toBeNull();
    expect(orders.map((order) => order.kind)).toContain('unloadPeople');
    expect(colony.garrison).toEqual([rider]);
  });
});
