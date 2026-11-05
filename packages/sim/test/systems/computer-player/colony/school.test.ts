import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony } from '../../../../src/components/index.js';
import { schoolLacking } from '../../../../src/systems/computer-player/colony/school.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { SCHOOL_TYPE, SEAT, STOCK_TYPE, technologyContent, VIKING } from '../support.js';

/** Spots on the east island, clear of its deposits and of each other. */
const COLONY_SCHOOL = { x: 160, y: 64 };
const COLONY_STORE = { x: 160, y: 84 };

describe('a colony school', () => {
  it('is the plan’s row once the store stands and while the colony has none', () => {
    const sim = colonyWorld(7, technologyContent());
    const terrain = sim.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
    const land = terrain.componentOf(terrain.nodeAt(COLONY_SCHOOL.x, COLONY_SCHOOL.y));
    const colony = blankColony(land);
    sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
    const env = looseColonyEnv(sim, colony);
    const place = (buildingType: number, at: { x: number; y: number }, underConstruction: boolean) => {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType,
        ...at,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction,
      });
      sim.step();
      return [...sim.world.query(Building)].filter(
        (e) => sim.world.get(e, Building).buildingType === buildingType,
      );
    };
    expect(schoolLacking(env, [])).toEqual([]);
    const store = place(STOCK_TYPE, COLONY_STORE, false);
    expect(schoolLacking(env, store)).toEqual(['school']);
    const school = place(SCHOOL_TYPE, COLONY_SCHOOL, true);
    expect(schoolLacking(env, [...store, ...school])).toEqual([]);
  });
});
