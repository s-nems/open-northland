import { describe, expect, it } from 'vitest';
import { aiControlEntity, Vehicle } from '../../../../../src/components/index.js';
import type { Simulation } from '../../../../../src/index.js';
import { homeSettlers } from '../../../../../src/systems/ai-shared/home-roster.js';
import { seatBaseOf } from '../../../../../src/systems/computer-player/base.js';
import { strayCrewsHome } from '../../../../../src/systems/computer-player/colony/sea/stray-ships.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../../src/systems/computer-player/sea-ships.js';
import { interactionCell } from '../../../../../src/systems/settlers/targets/index.js';
import { attachToVehicle, boardRider } from '../../../../../src/systems/vehicles/crew.js';
import {
  colonyState,
  colonyWorld,
  editColony,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { routedWorld } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT } from '../../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
/** Off the colony's shore. */
const STRAY_AT = { x: 138, y: 60 };
const ROUND_DUE_TICKS = minutesToTicks(30);

/** The land under the seat's headquarters. */
function homeLandOfSeat(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const base = seatBaseOf(sim.world, ctx, SEAT);
  if (terrain === undefined || base === null) throw new Error('setup: no base');
  return terrain.componentOf(interactionCell(sim.world, ctx, terrain, base));
}

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
});
