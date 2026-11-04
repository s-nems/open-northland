import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony } from '../../../../src/components/index.js';
import { schoolLacking } from '../../../../src/systems/computer-player/colony/school.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { SCHOOL_TYPE, SEAT, technologyContent, VIKING } from '../support.js';

/** A spot on the east island, clear of its deposits. */
const COLONY_SCHOOL = { x: 160, y: 64 };

describe('a colony school', () => {
  it('is the plan’s row while the colony has none, and no row once one stands', () => {
    const sim = colonyWorld(7, technologyContent());
    const terrain = sim.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    const land = terrain.componentOf(terrain.nodeAt(COLONY_SCHOOL.x, COLONY_SCHOOL.y));
    const colony = blankColony(land);
    sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
    const env = looseColonyEnv(sim, colony);
    expect(schoolLacking(env, [])).toEqual(['school']);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: SCHOOL_TYPE,
      ...COLONY_SCHOOL,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: true,
    });
    sim.step();
    const school = [...sim.world.query(Building)].filter(
      (e) => sim.world.get(e, Building).buildingType === SCHOOL_TYPE,
    );
    expect(schoolLacking(env, school)).toEqual([]);
  });
});
