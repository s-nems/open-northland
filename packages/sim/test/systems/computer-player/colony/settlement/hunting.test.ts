import { describe, expect, it } from 'vitest';
import { Livestock, Settler } from '../../../../../src/components/index.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { addFishSwarms } from '../../../../../src/systems/economy/fish.js';
import {
  colonySettlersOf,
  colonyState,
  colonyWorld,
  huntingColonyContent,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { COW_TRIBE, HUNTER } from '../../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const FOUND_DUE_TICKS = minutesToTicks(16);
const GATHER_DUE_TICKS = minutesToTicks(4);
const SEED = 7;
/** A swarm in the strait off the east island's shore, and its fish. */
const EAST_FISH_AT = { hx: 134, hy: 60 };
const FISH_IN_SWARM = 40;
/** A cow this far south of the colony's site grazes inside its store hunters' ground. */
const COW_DY = 6;

describe('a running colony', () => {
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

  it('puts no man on the hunter seat while a wild cow grazes within the hunt and fish feed it, so the cow lives', () => {
    const sim = colonyWorld(SEED, huntingColonyContent());
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    addFishSwarms(sim.world, terrain, [{ ...EAST_FISH_AT, count: FISH_IN_SWARM, continent: 0 }]);
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('setup: no site');
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: COW_TRIBE,
      x: site.hx,
      y: site.hy + COW_DY,
      count: 1,
    });
    sim.step();
    const [cow] = sim.world.query(Livestock);
    if (cow === undefined) throw new Error('setup: no cow');
    stepUntil(sim, GATHER_DUE_TICKS, () => false);
    expect(colonySettlersOf(sim).filter((e) => sim.world.get(e, Settler).jobType === HUNTER)).toEqual([]);
    expect(sim.world.isAlive(cow)).toBe(true);
  });
});
