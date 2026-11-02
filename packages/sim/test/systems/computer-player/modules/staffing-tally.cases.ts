import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Owner, Person, Settler } from '../../../../src/components/index.js';
import { ZERO } from '../../../../src/core/fixed.js';
import type { Entity, World } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { buildStaffingTally } from '../../../../src/systems/computer-player/workforce/tally.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { JOINER, JOINERY_TYPE, MILL_TYPE, MILLER, SEAT, VIKING } from '../support.js';

/** The seat's staffing tally across owners: it reads the seat's own buildings and wherever its settlers
 *  are bound, and each of those counts every bound settler, as a whole-world tally would. */

const RIVAL = 3;

function addBuilding(world: World, buildingType: number, owner: number): Entity {
  const e = world.create();
  world.add(e, Building, { buildingType, tribe: VIKING, built: ZERO, level: 0 });
  world.add(e, Owner, { player: owner });
  return e;
}

function addWorker(world: World, jobType: number | null, owner: number, workplace: Entity): Entity {
  const e = world.create();
  world.add(e, Person, { person: true });
  world.add(e, Settler, { tribe: VIKING, jobType });
  world.add(e, Owner, { player: owner });
  world.add(e, JobAssignment, { workplace });
  return e;
}

describe('the staffing tally', () => {
  it('counts a foreign settler at a seat building and a seat settler at a foreign one', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { world } = sim;
    const ctx = ctxOf(sim);
    const joinery = addBuilding(world, JOINERY_TYPE, SEAT);
    const rivalMill = addBuilding(world, MILL_TYPE, RIVAL);
    const rivalOnlyMill = addBuilding(world, MILL_TYPE, RIVAL);
    addWorker(world, JOINER, SEAT, joinery);
    addWorker(world, JOINER, RIVAL, joinery);
    addWorker(world, null, SEAT, joinery);
    addWorker(world, MILLER, SEAT, rivalMill);
    addWorker(world, MILLER, RIVAL, rivalMill);
    addWorker(world, MILLER, RIVAL, rivalOnlyMill);

    const tally = buildStaffingTally(world, ctx, SEAT, ownedBuildings(world, SEAT));

    // A whole-world tally holds these counts at every workplace the seat reads; the idle man counts nowhere.
    expect(tally.get(joinery)).toEqual(new Map([[JOINER, 2]]));
    expect(tally.get(rivalMill)).toEqual(new Map([[MILLER, 2]]));
    // No seat building and no seat settler leads to this mill, so the seat's staffing never reads it.
    expect(tally.has(rivalOnlyMill)).toBe(false);
  });
});
