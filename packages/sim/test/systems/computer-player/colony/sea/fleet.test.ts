import { describe, expect, it } from 'vitest';
import { aiControlEntity, type ColonyScout, ComputerColony } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { NO_COMPONENT } from '../../../../../src/nav/terrain/index.js';
import {
  colonyHeldShips,
  colonyOverflow,
  colonyWantsShips,
  liveColonyLands,
} from '../../../../../src/systems/ai-shared/home-roster.js';
import {
  colonySmallShips,
  colonyTradeShips,
} from '../../../../../src/systems/computer-player/colony/sea/fleet.js';
import { blankColony, colonyContent, colonyWorld } from '../../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT } from '../../support.js';

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

describe('the carrying ship ahead of the scouting', () => {
  it("is owed from the site's choice and through the scouting", () => {
    const sim = colonyWorld();
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.add(carrier, ComputerColony, {
      colonies: [
        blankColony(NEAR_LAND, { phase: 'siteChosen' }),
        blankColony(FAR_LAND, { phase: 'scouting', scout: scoutOf(FIRST_SHIP) }),
      ],
      rejected: [],
      retryAt: 0,
    });
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(2);
  });

  it('is owed for the first colony before its site where the seat may build the trade ship', () => {
    const sim = colonyWorld(undefined, colonyContent(true));
    expect(colonyTradeShips(sim.world, ctxOf(sim), SEAT)).toBe(1);
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.add(carrier, ComputerColony, {
      colonies: [blankColony(NEAR_LAND, { phase: 'fittingOut', ship: FIRST_SHIP })],
      rejected: [],
      retryAt: 0,
    });
    expect(colonyTradeShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
  });

  it('is not owed before a site where the seat sails small ships, its landing fleet scouts and carries', () => {
    const sim = colonyWorld();
    expect(colonySmallShips(sim.world, ctxOf(sim), SEAT)).toBe(0);
  });
});
