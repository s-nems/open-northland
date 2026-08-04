import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { setJob } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Employment is DIRECTED: a settler is employed by the `assignWorker` order and by nothing else. The engine
 * has no pass that notices an open slot, an unposted carrier, or a worker standing on the workplace it
 * staffs, and puts them together - staffing a building is the player's decision (the AI player makes its own,
 * through the same order).
 *
 * The cost of that rule is deliberate and pinned below: a trade whose work runs through a binding is INERT
 * until the settler is also posted somewhere. Giving a colonist the carrier trade is half a decision; the
 * other half is telling it where to work.
 */

const VIKING = 1;
const HUMAN = 0;
const CARRIER = 36; // the HQ's transport slot
const CIVILIAN = 6; // `jobtypes.ini` civilist - an assignable trade no workplace employs
const PLANK = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2; // one carpenter slot, ungated in the fixture

function buildingAt(sim: Simulation, buildingType: number, x: number, stock: Array<[number, number]> = []) {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function settlerAt(sim: Simulation, x: number, jobType: number | null): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

describe('nothing employs a settler on its own', () => {
  it('leaves a trade-less settler trade-less beside an open, ungated workplace', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    buildingAt(sim, SAWMILL, 3); // its one carpenter slot stands open all run
    const idle = settlerAt(sim, 0, null);

    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(idle, Settler).jobType).toBeNull();
    expect(sim.world.has(idle, JobAssignment)).toBe(false);
  });

  it('leaves a settler standing ON the workplace it could staff unbound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    buildingAt(sim, SAWMILL, 3);
    const carpenter = settlerAt(sim, 3, 2); // the sawmill's own trade, on its tile

    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.has(carpenter, JobAssignment)).toBe(false);
  });

  it('leaves a carrier given its trade but no post inert - the deliberate cost of the rule', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    buildingAt(sim, SAWMILL, 3, [[PLANK, 3]]); // planks waiting to be hauled…
    buildingAt(sim, HEADQUARTERS, 5); // …and a store with room for them
    const hauler = settlerAt(sim, 0, CIVILIAN);

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: hauler, jobType: CARRIER });
    for (let i = 0; i < 120; i++) sim.step();

    expect(sim.world.get(hauler, Settler).jobType).toBe(CARRIER); // it IS a carrier…
    expect(sim.world.has(hauler, JobAssignment)).toBe(false); // …with nowhere to work
    expect(sim.world.has(hauler, Carrying)).toBe(false);
    expect(sim.world.has(hauler, MoveGoal)).toBe(false);
    expect(sim.world.has(hauler, CurrentAtomic)).toBe(false);
  });
});
