import { describe, expect, it } from 'vitest';
import { Rider, Settler, Vehicle } from '../../../../src/components/index.js';
import { colonyHeldShips } from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { seatNeedsShips } from '../../../../src/systems/computer-player/sea-route.js';
import { isFighterJob } from '../../../../src/systems/readviews/index.js';
import { colonyState, colonyWorld, mooredShip, stepUntil } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const UNLOAD_TICKS = 4;

describe('a colony scouts its site', () => {
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
});
