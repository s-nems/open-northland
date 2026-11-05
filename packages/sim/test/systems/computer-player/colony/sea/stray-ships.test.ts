import { describe, expect, it } from 'vitest';
import { aiControlEntity, Vehicle } from '../../../../../src/components/index.js';
import { homeSettlers } from '../../../../../src/systems/ai-shared/home-roster.js';
import { strayCrewsHome } from '../../../../../src/systems/computer-player/colony/sea/stray-ships.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { attachToVehicle, boardRider } from '../../../../../src/systems/vehicles/crew.js';
import {
  colonyState,
  colonyWorld,
  editColony,
  mooredShip,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT } from '../../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);

describe("the seat's stray crews", () => {
  it('step off at home as home people, though a colony listed them', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    const ctx = ctxOf(sim);
    const carrier = aiControlEntity(sim.world, SEAT);
    const hand = homeSettlers(sim.world, ctx, SEAT)[0];
    if (ctx.terrain === undefined || carrier === null || hand === undefined)
      throw new Error('setup: no seat');
    const ship = mooredShip(sim);
    const berth = sim.world.get(ship, Vehicle).mooring;
    if (berth === null) throw new Error('setup: the ship lies unmoored');
    attachToVehicle(sim.world, ctx, { kind: 'attachToVehicle', entity: hand, vehicle: ship });
    boardRider(sim.world, hand, ship);
    editColony(sim).rest.push(hand);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(hand);
    const env = { world: sim.world, ctx, terrain: ctx.terrain, seat: SEAT, carrier };
    expect(strayCrewsHome(env, berth)).toContainEqual(expect.objectContaining({ kind: 'unloadPeople' }));
    expect(colonyState(sim)?.rest).not.toContain(hand);
    expect(homeSettlers(sim.world, ctx, SEAT)).toContain(hand);
  });
});
