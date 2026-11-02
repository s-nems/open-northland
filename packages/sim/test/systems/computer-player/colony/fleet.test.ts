import { describe, expect, it } from 'vitest';
import { aiControlEntity, type ColonyScout, ComputerColony } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { NO_COMPONENT } from '../../../../src/nav/terrain/index.js';
import {
  colonyHeldShips,
  colonyOverflow,
  colonyWantsShips,
  liveColonyLands,
} from '../../../../src/systems/ai-shared/home-roster.js';
import { colonySmallShips } from '../../../../src/systems/computer-player/colony/fleet.js';
import { blankColony, colonyWorld } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const FIRST_SHIP = 901 as Entity;
const SECOND_SHIP = 902 as Entity;
const THIRD_SHIP = 903 as Entity;
const HELM = 904 as Entity;
const NEAR_LAND = 5;
const FAR_LAND = 6;

const scoutOf = (ship: Entity): ColonyScout => ({ ship, helm: HELM, waypoints: [], leg: 0 });

/** A seat with one colony fitting out, one running and one given up. */
function threeColonies() {
  const sim = colonyWorld();
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no carrier');
  const handed = { line: 'tools', step: 0, building: 'work_smithy_00' } as const;
  sim.world.add(carrier, ComputerColony, {
    colonies: [
      blankColony(NEAR_LAND, { phase: 'fittingOut', scout: scoutOf(FIRST_SHIP), ship: null }),
      blankColony(FAR_LAND, { phase: 'fittingOut', scout: scoutOf(SECOND_SHIP) }),
      blankColony(NO_COMPONENT, { phase: 'abandoned', ship: THIRD_SHIP, overflow: [{ ...handed }] }),
    ],
    rejected: [],
    retryAt: 0,
  });
  return sim;
}

describe('a seat of several colonies', () => {
  it('owes each colony its own ship', () => {
    const sim = threeColonies();
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(2);
  });

  it('holds the ships of all of them, an abandoned one among them', () => {
    const sim = threeColonies();
    expect(colonyHeldShips(sim.world, SEAT)).toEqual([FIRST_SHIP, SECOND_SHIP, THIRD_SHIP]);
  });

  it('reads live land and hand-overs off the live ones only', () => {
    const sim = threeColonies();
    expect(liveColonyLands(sim.world, SEAT)).toEqual([NEAR_LAND, FAR_LAND]);
    expect(colonyOverflow(sim.world, SEAT)).toEqual([]);
    expect(colonyWantsShips(sim.world, SEAT)).toBe(true);
  });
});
