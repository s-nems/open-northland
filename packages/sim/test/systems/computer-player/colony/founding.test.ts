import { describe, expect, it } from 'vitest';
import { Building } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import {
  colonyBuildingsOf,
  colonyState,
  colonyWorld,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { STOCK_TOP_TYPE, STOCK_TYPE } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const LANDING_DUE_TICKS = minutesToTicks(8);
/** A few workforce beats. */
const REPLACE_DUE_TICKS = minutesToTicks(2);
const SECOND_SHIP_AT = { x: 90, y: 100 };

/** The colony's warehouses, sites included. */
function storesOf(sim: Simulation): Entity[] {
  return colonyBuildingsOf(sim).filter((e) =>
    [STOCK_TYPE, STOCK_TOP_TYPE].includes(sim.world.get(e, Building).buildingType),
  );
}

describe('a founding colony', () => {
  it('places its store again once the one it had is lost', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, SCOUT_DUE_TICKS + LANDING_DUE_TICKS, () => storesOf(sim).length > 0)).toBe(true);
    for (const e of storesOf(sim)) sim.world.destroy(e);
    expect(stepUntil(sim, REPLACE_DUE_TICKS, () => storesOf(sim).length > 0)).toBe(true);
    expect(colonyState(sim)?.phase).not.toBe('abandoned');
  });
});
