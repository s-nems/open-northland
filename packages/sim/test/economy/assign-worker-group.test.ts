import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  addPerson,
  Building,
  CurrentAtomic,
  JobAssignment,
  Owner,
  Position,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { assignWorker, assignWorkerGroup } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The `assignWorkerGroup` command: a group posted to one building fills its seats nearest first with
 * its unemployed members while there are any, otherwise with its members employed elsewhere. The shared
 * fixture's sawmill (type 2) has one carpenter seat; the twin mill (type 8) has two.
 */

const VIKING = 1;
const PLAYER = 0;
const CARPENTER = 2;
const SAWMILL = 2;
const TWIN_MILL = 8;
const SOME_ATOMIC = 1;

function placeBuilding(sim: Simulation, buildingType: number, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  return e;
}

/** An owned, tradeless viking adult standing at column `x`. */
function settlerAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function employ(sim: Simulation, worker: Entity, building: Entity): void {
  assignWorker(sim.world, ctxOf(sim), {
    kind: 'assignWorker',
    entity: worker,
    building,
    jobPriority: [CARPENTER],
  });
}

function postGroup(sim: Simulation, building: Entity, members: readonly Entity[]): void {
  assignWorkerGroup(sim.world, ctxOf(sim), {
    kind: 'assignWorkerGroup',
    building,
    members: members.map((entity) => ({ entity, jobPriority: [CARPENTER] })),
  });
}

const workplaceOf = (sim: Simulation, e: Entity): Entity | undefined =>
  sim.world.tryGet(e, JobAssignment)?.workplace;

describe('assignWorkerGroup - post a group to one building', () => {
  it('seats an unemployed member before one employed elsewhere, even a nearer one listed first', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const oldMill = placeBuilding(sim, SAWMILL, 30);
    const clicked = placeBuilding(sim, SAWMILL, 10);
    const employed = settlerAt(sim, 10);
    const idle = settlerAt(sim, 40);
    employ(sim, employed, oldMill);

    postGroup(sim, clicked, [employed, idle]);

    expect(workplaceOf(sim, idle)).toBe(clicked);
    expect(workplaceOf(sim, employed)).toBe(oldMill);
  });

  it('moves members employed elsewhere when none of the group is unemployed', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const oldMill = placeBuilding(sim, SAWMILL, 30);
    const clicked = placeBuilding(sim, TWIN_MILL, 10);
    const employed = settlerAt(sim, 30);
    employ(sim, employed, oldMill);

    postGroup(sim, clicked, [employed]);

    expect(workplaceOf(sim, employed)).toBe(clicked);
  });

  it('keeps members employed elsewhere put while any member is unemployed, though seats are left', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const first = placeBuilding(sim, SAWMILL, 10);
    const bigger = placeBuilding(sim, TWIN_MILL, 40);
    const group = [settlerAt(sim, 11), settlerAt(sim, 12)];

    postGroup(sim, first, group);
    postGroup(sim, bigger, group);

    expect(group.map((e) => workplaceOf(sim, e))).toEqual([first, bigger]);
  });

  it('gives a short supply of seats to the unemployed members nearest the building', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const clicked = placeBuilding(sim, SAWMILL, 10);
    const far = settlerAt(sim, 40);
    const near = settlerAt(sim, 12);

    postGroup(sim, clicked, [far, near]);

    expect(workplaceOf(sim, near)).toBe(clicked);
    expect(workplaceOf(sim, far)).toBeUndefined();
  });

  it('leaves a member already working there undisturbed', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const clicked = placeBuilding(sim, TWIN_MILL, 10);
    const working = settlerAt(sim, 10);
    const idle = settlerAt(sim, 12);
    employ(sim, working, clicked);
    addCurrentAtomic(sim.world, working, {
      atomicId: SOME_ATOMIC,
      duration: 1,
      effect: { kind: 'sleep' },
      targetEntity: null,
      targetTile: null,
    });

    postGroup(sim, clicked, [working, idle]);

    expect(workplaceOf(sim, idle)).toBe(clicked);
    expect(workplaceOf(sim, working)).toBe(clicked);
    expect(sim.world.has(working, CurrentAtomic)).toBe(true); // not re-hired, so not re-idled
  });
});
