import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  Felling,
  HaulFlag,
  JobAssignment,
  LostWay,
  MoveGoal,
  Owner,
  Position,
  Resource,
  Stockpile,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, ONE, Simulation } from '../../../src/index.js';
import { worksFieldFromPost } from '../../../src/systems/economy/haul-flag.js';
import { anchorOnlyFootprint, stampResourceFootprintData } from '../../../src/systems/index.js';
import { workStatus } from '../../../src/systems/readviews/work-status.js';
import { CUT_OFF_CHECK_TICKS } from '../../../src/systems/settlers/drives/cut-off.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap } from '../../fixtures/terrain.js';

/**
 * A posted carrier's pickup flag: a warehouse or workshop carrier the player gave a flag lifts ground piles
 * and workshop output only around it, waits there when none lie there, and a workshop carrier looks there
 * for its missing inputs before the stores elsewhere. Fixture: HQ (type 1) stocks planks and wood, the twin mill (type 8) seats a
 * carrier and runs wood -> plank, the farm (type 5) is a field producer.
 */

const CARRIER = 36;
const WOODCUTTER = 1;
const COLLECTOR = 7;
const HUNTER = 15;
const FARMER = 18;
/** The fixture's wood harvest atomic, which the collector is granted. */
const HARVEST_WOOD = 24;
const HEADQUARTERS = 1;
const FARM = 5;
const TWIN_MILL = 8;
const WOOD = 1;
const PLANK = 2;
const VIKING = 1;
const PLAYER = 0;
/** Ticks enough for a carrier to plan and set off. */
const PLAN_TICKS = 40;
/** Ticks enough for a carrier to walk the strip and back with a load. */
const RUN_TICKS = 1500;
/** Ticks enough to fell a tree 50 cells out and carry its trunk home in two loads (about 5100 needed). */
const FAR_TRUNK_TICKS = 7500;

function world(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassCellMap(40, 2) });
}

function buildingAt(s: Simulation, buildingType: number, x: number, stock: [number, number][] = []): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  s.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  s.world.add(e, Stockpile, { amounts: new Map(stock) });
  s.world.add(e, Owner, { player: PLAYER });
  return e;
}

function workerAt(s: Simulation, x: number, post?: Entity, jobType = CARRIER): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  addPerson(s.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  s.world.add(e, Owner, { player: PLAYER });
  if (post !== undefined) s.world.add(e, JobAssignment, { workplace: post });
  return e;
}

function pileAt(s: Simulation, x: number, good: number, amount: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  s.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
  return e;
}

function plantFlag(s: Simulation, carrier: Entity, x: number): void {
  const n = cellAnchorNode(x, 0);
  s.enqueueSetup({ kind: 'setWorkFlag', entity: carrier, x: n.hx, y: n.hy });
  s.step();
}

/** The cell column the carrier is walking to once it set off, or null while it stands. */
function headingColumn(s: Simulation, carrier: Entity): number | null {
  for (let t = 0; t < PLAN_TICKS; t++) {
    const goal = s.world.tryGet(carrier, MoveGoal);
    if (goal !== undefined && s.terrain !== undefined) return Math.floor(s.terrain.xOf(goal.cell) / 2);
    s.step();
  }
  return null;
}

function columnOf(s: Simulation, e: Entity): number {
  return fx.toInt(s.world.get(e, Position).x);
}

function stockOf(s: Simulation, e: Entity, good: number): number {
  return s.world.get(e, Stockpile).amounts.get(good) ?? 0;
}

describe('carrier pickup flag', () => {
  it('plants a flag with the gatherer radius for a warehouse carrier, and refuses other carriers', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const farm = buildingAt(s, FARM, 10);
    const porter = workerAt(s, 1, hq);
    const farmCarrier = workerAt(s, 11, farm);
    const loose = workerAt(s, 12);
    plantFlag(s, porter, 20);
    plantFlag(s, farmCarrier, 20);
    plantFlag(s, loose, 20);

    const flag = s.world.get(porter, HaulFlag);
    expect(flag.radius).toBe(DEFAULT_WORK_FLAG_RADIUS);
    expect(s.world.has(flag.flag, DeliveryFlag)).toBe(true);
    expect(s.world.has(farmCarrier, HaulFlag)).toBe(false);
    expect(s.world.has(loose, HaulFlag)).toBe(false);
  });

  it("turns a retrained carrier's pickup flag into its new flag trade's work flag, never one beside it", () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    plantFlag(s, porter, 20);
    const pickup = s.world.get(porter, HaulFlag).flag;

    s.enqueueSetup({ kind: 'setJob', entity: porter, jobType: COLLECTOR });
    s.step();

    expect(s.world.has(porter, JobAssignment)).toBe(false);
    expect(s.world.has(porter, HaulFlag)).toBe(false);
    expect(s.world.get(porter, WorkFlag).flag).toBe(pickup);
  });

  it('lifts piles around the flag only, and waits there when none is left', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    const nearPorter = pileAt(s, 3, PLANK, 1);
    const atFlag = pileAt(s, 26, PLANK, 1);
    plantFlag(s, porter, 24);
    for (let t = 0; t < RUN_TICKS && stockOf(s, hq, PLANK) === 0; t++) s.step();
    expect(s.world.isAlive(atFlag) && stockOf(s, atFlag, PLANK) > 0).toBe(false);
    expect(stockOf(s, hq, PLANK)).toBe(1);

    // Nothing left in its area: it walks back out to the flag and leaves the heap by the store alone.
    for (let t = 0; t < RUN_TICKS; t++) s.step();
    expect(stockOf(s, nearPorter, PLANK)).toBe(1);
    expect(headingColumn(s, porter) ?? columnOf(s, porter)).toBeGreaterThanOrEqual(23);
  });

  it("hauls a workshop's output around the flag, whichever pickup lies nearer the flag first", () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    const mill = buildingAt(s, TWIN_MILL, 22, [[PLANK, 1]]);
    const pile = pileAt(s, 31, PLANK, 1);
    plantFlag(s, porter, 24);
    for (let t = 0; t < RUN_TICKS && stockOf(s, hq, PLANK) === 0; t++) s.step();
    expect(stockOf(s, mill, PLANK)).toBe(0);
    expect(stockOf(s, pile, PLANK)).toBe(1);

    const s2 = world();
    const hq2 = buildingAt(s2, HEADQUARTERS, 0);
    const porter2 = workerAt(s2, 1, hq2);
    const mill2 = buildingAt(s2, TWIN_MILL, 32, [[PLANK, 1]]);
    const pile2 = pileAt(s2, 25, PLANK, 1);
    plantFlag(s2, porter2, 24);
    for (let t = 0; t < RUN_TICKS && stockOf(s2, hq2, PLANK) === 0; t++) s2.step();
    expect(s2.world.isAlive(pile2) && stockOf(s2, pile2, PLANK) > 0).toBe(false);
    expect(stockOf(s2, mill2, PLANK)).toBe(1);
  });

  it('wakes a porter idling at its flag when the flag moves over a pile', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    const pile = pileAt(s, 8, PLANK, 1);
    plantFlag(s, porter, 30);
    for (let t = 0; t < RUN_TICKS; t++) s.step(); // nothing in the area: it walks out and settles at the flag
    expect(stockOf(s, pile, PLANK)).toBe(1);

    plantFlag(s, porter, 10); // only the marker's position changes
    for (let t = 0; t < RUN_TICKS && s.world.isAlive(pile); t++) s.step();
    expect(s.world.isAlive(pile) && stockOf(s, pile, PLANK) > 0).toBe(false);
  });

  it('reports a flagged carrier with nothing at its flag', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    expect(workStatus(s.world, ctxOf(s), porter)?.kind).not.toBe('nothingAtFlag');
    plantFlag(s, porter, 24);
    expect(workStatus(s.world, ctxOf(s), porter)).toEqual({ kind: 'nothingAtFlag' });
    // A farmer's flag bounds his plot, not a pickup area.
    const farmer = workerAt(s, 11, buildingAt(s, FARM, 10), FARMER);
    plantFlag(s, farmer, 24);
    expect(s.world.has(farmer, HaulFlag)).toBe(true);
    expect(workStatus(s.world, ctxOf(s), farmer)?.kind).not.toBe('nothingAtFlag');
  });

  it('collects wherever its signposts reach again once the flag is cleared', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    pileAt(s, 3, PLANK, 1);
    plantFlag(s, porter, 24);
    const marker = s.world.get(porter, HaulFlag).flag;

    s.enqueueSetup({ kind: 'clearHaulFlag', entity: porter });
    s.step();
    expect(s.world.has(porter, HaulFlag)).toBe(false);
    expect(s.world.isAlive(marker)).toBe(false);
    expect(headingColumn(s, porter)).toBeLessThan(10);
  });

  it('drops the flag with the post', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const porter = workerAt(s, 1, hq);
    plantFlag(s, porter, 24);
    const marker = s.world.get(porter, HaulFlag).flag;

    s.enqueueSetup({ kind: 'unassignWorker', entity: porter });
    s.step();
    expect(s.world.has(porter, HaulFlag)).toBe(false);
    expect(s.world.isAlive(marker)).toBe(false);
  });

  it("takes a workshop's missing input from the flag's piles before the stores", () => {
    const s = world();
    buildingAt(s, HEADQUARTERS, 0, [[WOOD, 5]]);
    const mill = buildingAt(s, TWIN_MILL, 4);
    const carrier = workerAt(s, 5, mill);
    pileAt(s, 26, WOOD, 1);
    plantFlag(s, carrier, 24);
    expect(headingColumn(s, carrier)).toBeGreaterThanOrEqual(24);

    // Nothing at the flag: the stores still supply it.
    const s2 = world();
    buildingAt(s2, HEADQUARTERS, 0, [[WOOD, 5]]);
    const mill2 = buildingAt(s2, TWIN_MILL, 4);
    const carrier2 = workerAt(s2, 5, mill2);
    plantFlag(s2, carrier2, 24);
    expect(headingColumn(s2, carrier2)).toBeLessThan(4);
  });

  it("takes a workshop's missing input from a store by the flag before a nearer one", () => {
    const s = world();
    buildingAt(s, HEADQUARTERS, 0, [[WOOD, 5]]);
    buildingAt(s, HEADQUARTERS, 26, [[WOOD, 5]]);
    const mill = buildingAt(s, TWIN_MILL, 4);
    const carrier = workerAt(s, 5, mill);
    plantFlag(s, carrier, 24);
    expect(headingColumn(s, carrier)).toBeGreaterThanOrEqual(20);
  });
});

describe('a haul flag beyond signpost reach', () => {
  /** Past the carrier's walk range on a strip with no post. */
  const FAR = 38;
  const IN_REACH = 6;

  it('is planted, the carrier stands lost at once, and a flag back in reach lifts the mark', () => {
    const s = world();
    s.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    s.step();
    const hq = buildingAt(s, HEADQUARTERS, 2, [[PLANK, 4]]);
    const carrier = workerAt(s, 3, hq);
    plantFlag(s, carrier, FAR);
    expect(s.world.has(carrier, HaulFlag)).toBe(true);
    expect(s.world.get(carrier, LostWay)).toMatchObject({ cutOff: true });
    expect(s.events.current()).toContainEqual({ kind: 'settlerLost', entity: carrier });
    expect(headingColumn(s, carrier)).toBeNull(); // it stands: nothing walks past its signposts
    expect(s.world.has(carrier, LostWay)).toBe(true);

    plantFlag(s, carrier, IN_REACH);
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS && s.world.has(carrier, LostWay); t++) s.step();
    expect(s.world.has(carrier, LostWay)).toBe(false);
  });
});

describe("a posted gatherer's flag", () => {
  function treeAt(s: Simulation, x: number, remaining: number): Entity {
    const e = s.world.create();
    s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
    s.world.add(e, Resource, { goodType: WOOD, remaining, harvestAtomic: HARVEST_WOOD });
    stampResourceFootprintData(s.world, e, anchorOnlyFootprint());
    return e;
  }

  function woodLeft(s: Simulation, tree: Entity): number {
    return s.world.isAlive(tree) ? s.world.get(tree, Resource).remaining : 0;
  }

  it('is given to a trade that gathers from a flag, never to one bound to its workhouse', () => {
    const content = testContent();
    expect(worksFieldFromPost(content, COLLECTOR)).toBe(true);
    expect(worksFieldFromPost(content, HUNTER)).toBe(true);
    expect(worksFieldFromPost(content, CARRIER)).toBe(false);
    // A workhouse trade that could still fell a tree reaps its hut's fields, not a flag's.
    const tied = {
      ...content,
      jobs: content.jobs.map((job) =>
        job.typeId === FARMER ? { ...job, allowedAtomics: [HARVEST_WOOD] } : job,
      ),
    };
    expect(worksFieldFromPost(tied, FARMER)).toBe(false);
    const s = new Simulation({ seed: 1, content: tied, map: grassCellMap(40, 2) });
    const farmer = workerAt(s, 11, buildingAt(s, FARM, 10), FARMER);
    plantFlag(s, farmer, 20);
    expect(s.world.has(farmer, HaulFlag)).toBe(false);
    expect(s.world.has(farmer, WorkFlag)).toBe(false);
  });

  it('is dropped when its man takes a post elsewhere', () => {
    const s = world();
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const store = buildingAt(s, HEADQUARTERS, 30);
    const woodcutter = workerAt(s, 1, hq, WOODCUTTER);
    plantFlag(s, woodcutter, 20);
    const marker = s.world.get(woodcutter, HaulFlag).flag;

    s.enqueueSetup({ kind: 'assignWorker', entity: woodcutter, building: store, jobPriority: [WOODCUTTER] });
    s.step();
    expect(s.world.get(woodcutter, JobAssignment).workplace).toBe(store);
    expect(s.world.has(woodcutter, HaulFlag)).toBe(false);
    expect(s.world.has(woodcutter, WorkFlag)).toBe(false);
    expect(s.world.isAlive(marker)).toBe(false);
  });

  it('harvests only around the flag, banks at its post and waits at the flag once the patch is cut', () => {
    const run = (flagged: boolean): { near: number; far: number; banked: number; column: number } => {
      const s = world();
      const hq = buildingAt(s, HEADQUARTERS, 0);
      const collector = workerAt(s, 1, hq, COLLECTOR);
      const near = treeAt(s, 4, 2);
      const far = treeAt(s, 30, 1);
      if (flagged) plantFlag(s, collector, 32);
      for (let t = 0; t < RUN_TICKS; t++) s.step();
      expect(s.world.get(collector, JobAssignment).workplace).toBe(hq);
      return {
        near: woodLeft(s, near),
        far: woodLeft(s, far),
        banked: stockOf(s, hq, WOOD),
        column: headingColumn(s, collector) ?? columnOf(s, collector),
      };
    };

    const flagged = run(true);
    expect(flagged.near).toBe(2);
    expect(flagged.far).toBe(0);
    expect(flagged.banked).toBeGreaterThan(0);
    expect(flagged.column).toBeGreaterThanOrEqual(30);
    // Without the flag the same man cuts the tree by the store first.
    expect(run(false).near).toBeLessThan(2);
  });

  it('carries home the trunk of a tree felled at the edge of the flag area', () => {
    const s = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(70, 2) });
    const hq = buildingAt(s, HEADQUARTERS, 0);
    const collector = workerAt(s, 1, hq, COLLECTOR);
    plantFlag(s, collector, 50);
    const { radius } = s.world.get(collector, HaulFlag);
    // The tree stands just past the radius; the cell it is felled from lies inside it, and the trunk
    // falls on the tree's own node.
    const WORK_OFFSET = 2;
    const tree = s.world.create();
    s.world.add(tree, Position, { x: fx.fromInt(50 - (radius + WORK_OFFSET) / 2), y: fx.fromInt(0) });
    s.world.add(tree, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: HARVEST_WOOD });
    s.world.add(tree, Felling, { chops: 0 });
    stampResourceFootprintData(s.world, tree, {
      walk: [{ dx: 0, dy: 0 }],
      build: [],
      work: [{ dx: WORK_OFFSET, dy: 0 }],
    });

    for (let t = 0; t < FAR_TRUNK_TICKS && stockOf(s, hq, WOOD) < 4; t++) s.step();

    expect(woodLeft(s, tree)).toBe(0);
    expect(stockOf(s, hq, WOOD)).toBe(4);
  });
});
