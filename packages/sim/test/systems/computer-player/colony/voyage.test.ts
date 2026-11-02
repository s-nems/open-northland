import { describe, expect, it } from 'vitest';
import { Rider, Settler, Vehicle } from '../../../../src/components/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../src/systems/ai-shared/cadence.js';
import { colonyHeldShips } from '../../../../src/systems/ai-shared/home-roster.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { freeShips } from '../../../../src/systems/computer-player/military/operations/landing.js';
import { seatNeedsShips } from '../../../../src/systems/computer-player/sea-route.js';
import { isFighterJob } from '../../../../src/systems/readviews/index.js';
import {
  colonyState,
  colonyWorld,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const UNLOAD_TICKS = 4;
const DECISION_TICKS = COMPUTER_DECISION_INTERVAL_TICKS + 1;
const FIT_OUT_TICKS = minutesToTicks(21);
const SECOND_SHIP_AT = { x: 90, y: 100 };

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
