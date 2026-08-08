import { describe, expect, it } from 'vitest';
import {
  Health,
  JobAssignment,
  Position,
  Settler,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../../src/index.js';
import { BUILDER_CAP, type BuildOrderEntry, buildOrderModule } from '../../../src/systems/ai-player/index.js';
import { razeBuilding } from '../../../src/systems/lifecycle/cleanup.js';
import {
  aiSim,
  BAKER,
  BAKERY_TYPE,
  BREWERY_TYPE,
  BUILDER,
  CIVILIST,
  COLLECTOR,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  MILL_TYPE,
  placeHq,
  SCOUT,
  SEAT,
  STOCK_TYPE,
  spawnMen,
  VIKING,
} from './support.js';

/**
 * Loss recovery - what the seat does once combat takes a building or a worker off it: the rebuild
 * outranks the list's unreached entries, a razed base comes back as a warehouse, and the vacated
 * posts are filled again.
 */

/** Two entries the fixture worlds satisfy and one they have not reached, so a rebuild and a first
 *  build compete for the seat's single site. */
const ORDER: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_bakery_00', count: 1 },
  { kind: 'place', building: 'work_mill_00', count: 1 },
  { kind: 'place', building: 'work_brewery', count: 1 },
];

function place(sim: Simulation, buildingType: number, x: number, y: number): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
}

function placementOf(commands: readonly Command[]): Extract<Command, { kind: 'placeBuilding' }> | null {
  const first = commands[0];
  return first?.kind === 'placeBuilding' ? first : null;
}

/** Take a building down through the seam combat shares with `demolish` - it unbinds the workers a
 *  raw `world.destroy` would strand on a dead entity. */
function raze(sim: Simulation, building: Entity): void {
  razeBuilding(sim.world, ctxOf(sim), building);
}

function staffOf(sim: Simulation, building: Entity): Entity[] {
  return [...sim.world.query(Settler, JobAssignment)].filter(
    (e) => sim.world.get(e, JobAssignment).workplace === building,
  );
}

/** Run the allocator and apply everything it decided, so the next run sees the posts it made. */
function allocateAndApply(sim: Simulation): void {
  for (const command of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(command);
  sim.step();
}

describe('build-order module - rebuilding what combat took', () => {
  const module = buildOrderModule(ORDER);

  it('re-places a razed building before the entry the seat has not reached yet', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    place(sim, MILL_TYPE, 38, 16);
    sim.step();
    // Both built entries stand, so the list has moved on to the brewery.
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(BREWERY_TYPE);

    raze(sim, entityOfBuilding(sim, BAKERY_TYPE));
    // Its entry regressed to unmet and the walk stops there: the rebuild outranks the brewery.
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(BAKERY_TYPE);
  });

  it('replaces a razed base with a level-1 warehouse at the centre of what still stands', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    place(sim, MILL_TYPE, 38, 16);
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    const replacement = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(replacement?.buildingType).toBe(STOCK_TYPE);
    expect(replacement?.owner).toBe(SEAT);
    expect(replacement?.tribe).toBe(VIKING);
    expect(replacement?.underConstruction).toBe(true);
    // The survivors' centroid, not the razed headquarters' node at x=30.
    expect({ x: replacement?.x, y: replacement?.y }).toEqual({ x: 36, y: 16 });
  });

  it('resumes the opening list once the replacement warehouse stands', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));
    place(sim, STOCK_TYPE, 36, 16); // the replacement, finished
    sim.step();

    // The warehouse is the seat's base now, and the executor is back on the list at the mill entry.
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(MILL_TYPE);
  });

  it('opens one replacement site, then waits for it like any other entry', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));
    const first = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(first?.buildingType).toBe(STOCK_TYPE);
    if (first === null) return;

    sim.enqueueSetup(first);
    sim.step();
    expect([...sim.world.query(UnderConstruction)]).toHaveLength(1);
    // Still baseless (the site is unbuilt), but the one-site gate outranks the recovery rung.
    expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('leaves a seat holding no buildings idle - it never had a base to lose', () => {
    const sim = aiSim();
    spawnMen(sim, 4, BUILDER);
    sim.step();
    expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('crews the site blocking its recovery after the raid took every builder', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 4, CIVILIST); // no builder survives the raid
    // A mill site is already open when the base falls - the normal state, since the seat keeps one.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
      x: 38,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    // The one-site gate holds the replacement back until the mill finishes, and this allocator is
    // the only thing that mints builders - without the rebuild crew the seat could never get either.
    expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    const hires = collectModule
      .run(sim.world, ctxOf(sim), SEAT)
      .filter((c) => c.kind === 'setJob' && c.jobType === BUILDER);
    expect(hires.length).toBeGreaterThan(0);

    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, MILL_TYPE) });
    sim.step();
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(STOCK_TYPE);
  });

  /** The crew is drawn from every class, because the phases that would recycle a scout or a gatherer
   *  live in the based branch that a baseless seat never runs. Each of these survivor sets left the
   *  seat issuing NOTHING, for good, while the crew took the spare pool alone. */
  it.each([
    ['scouts', SCOUT],
    ['generic gatherers', COLLECTOR],
  ])('crews the site out of surviving %s', (_label, jobType) => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 2, jobType);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
      x: 38,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    const hires = collectModule
      .run(sim.world, ctxOf(sim), SEAT)
      .filter((c) => c.kind === 'setJob' && c.jobType === BUILDER);
    expect(hires.length).toBeGreaterThan(0);
  });

  it('pulls a man off his post when no one else is left to raise the site', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 1, CIVILIST);
    sim.step();
    // The seat's only man stands at a post, so nothing at all is spare.
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    const man = [...sim.world.query(Settler)][0];
    if (man === undefined) throw new Error('setup: no settler spawned');
    sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: bakery, jobPriority: [BAKER] });
    sim.step();
    expect(staffOf(sim, bakery)).toEqual([man]);

    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
      x: 38,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    // `setJob` drops the binding, so the post empties and the man builds. The ladder re-staffs him
    // once the base is back - a hub the settlement cannot store into outranks one running bakery.
    const posted = staffOf(sim, bakery)[0];
    expect(collectModule.run(sim.world, ctxOf(sim), SEAT)).toContainEqual({
      kind: 'setJob',
      entity: posted,
      jobType: BUILDER,
    });
  });

  it('still fills a vacancy while it is baseless, once the site has its crew', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 12, CIVILIST); // more than the builder reserve claims
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
      x: 38,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    // The raid that razes the hub is the raid that kills the baker, so minimum staffing has to keep
    // running through the rebuild - just behind the crew, never instead of it.
    const commands = collectModule.run(sim.world, ctxOf(sim), SEAT);
    expect(commands.filter((c) => c.kind === 'setJob' && c.jobType === BUILDER)).toHaveLength(BUILDER_CAP);
    expect(commands).toContainEqual(
      expect.objectContaining({
        kind: 'assignWorker',
        building: entityOfBuilding(sim, BAKERY_TYPE),
        jobPriority: [BAKER],
      }),
    );
  });

  it('anchors on the warehouse in the settlement, not the far-flung outpost', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    place(sim, STOCK_TYPE, 4, 4); // an authored outpost store, well outside the build disc
    place(sim, STOCK_TYPE, 36, 16); // the one standing in the settlement
    sim.step();
    const outpost = entityOfBuilding(sim, STOCK_TYPE); // lowest id of the two
    raze(sim, entityOfBuilding(sim, HQ_TYPE));

    // Ranked by distance to the settlement centroid, not by entity id: anchoring on the outpost
    // would drag the placement disc, the lattice centre and every search origin across the map.
    const next = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(next?.buildingType).toBe(MILL_TYPE);
    expect(Math.abs((next?.x ?? 0) - 36)).toBeLessThan(12);
    expect(sim.world.get(outpost, Position)).toEqual(positionOfNode(4, 4)); // the outpost still stands
  });
});

describe('workforce module - refilling the posts a loss emptied', () => {
  it('staffs a rebuilt workplace from scratch', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 10, BUILDER);
    sim.step();
    allocateAndApply(sim);
    const razed = entityOfBuilding(sim, BAKERY_TYPE);
    expect(staffOf(sim, razed).length).toBeGreaterThan(0);

    raze(sim, razed); // unbinds its workers, who fall back to the civilian pool
    place(sim, BAKERY_TYPE, 34, 16);
    sim.step();
    allocateAndApply(sim);
    expect(staffOf(sim, entityOfBuilding(sim, BAKERY_TYPE)).length).toBeGreaterThan(0);
  });

  it('posts a replacement operator the decision after its holder dies', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 10, BUILDER);
    sim.step();
    allocateAndApply(sim);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    const baker = staffOf(sim, bakery).find((e) => sim.world.get(e, Settler).jobType === BAKER);
    expect(baker).toBeDefined();
    if (baker === undefined) return;

    sim.world.mut(baker, Health).hitpoints = 0;
    sim.step(); // cleanupSystem reaps him, leaving the baker slot empty
    // Minimum staffing runs ahead of the builder reserve, so the vacancy outranks every other claim
    // on the civilian pool.
    expect(collectModule.run(sim.world, ctxOf(sim), SEAT)).toContainEqual({
      kind: 'assignWorker',
      entity: expect.any(Number),
      building: bakery,
      jobPriority: [BAKER],
    });
  });

  it('keeps allocating for a seat whose base is the warehouse that replaced its headquarters', () => {
    const sim = aiSim();
    placeHq(sim);
    place(sim, BAKERY_TYPE, 34, 16);
    spawnMen(sim, 10, BUILDER);
    sim.step();
    raze(sim, entityOfBuilding(sim, HQ_TYPE));
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]); // no base: idle

    place(sim, STOCK_TYPE, 36, 16);
    sim.step();
    allocateAndApply(sim);
    expect(staffOf(sim, entityOfBuilding(sim, BAKERY_TYPE)).length).toBeGreaterThan(0);
  });
});
