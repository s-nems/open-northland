import { describe, expect, it } from 'vitest';
import {
  Building,
  Felling,
  GatherSelection,
  JobAssignment,
  Owner,
  Position,
  Resource,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { setGatherGood, setJob } from '../../src/systems/orders/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * THE EMPLOYED GATHERER'S STORE FILTER (user rule 2026-07-16): a flag-less gatherer bound to a stocking
 * building forages ONLY for goods that building's stockpile stores — a smithy's collector fetches its
 * iron/wood, never the quarry's stone — narrowed further to one good by the `setGatherGood` command
 * (stored in {@link GatherSelection}; `null` resets to every stored good). The fixture collector (job 7)
 * may harvest wood AND stone; the sawmill stores wood only, so stone is what the filter must exclude.
 */

const WOOD = 1;
const STONE = 4;
const COLLECTOR = 7;
const WOODCUTTER = 1;
const VIKING = 1;
const HUMAN = 0;
const SAWMILL = 2; // fixture building type storing wood + plank (no stone)
const WAREHOUSE = 7; // fixture storage stocking every good (wood AND stone)
const WOOD_HARVEST = 24;
const STONE_HARVEST = 25;

const CHOPS_TO_FELL = testContent().goods.find((g) => g.id === 'wood')?.gathering?.chopsToFell ?? 0;

function placeBuilding(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** An OWNED collector employed at `workplace` (JobAssignment stamped directly — the planner only
 *  reads the binding, not how it was made). */
function employedCollector(sim: Simulation, x: number, y: number, workplace: Entity): Entity {
  const e = settlerAt(sim, { jobType: COLLECTOR, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
  sim.world.add(e, Owner, { player: HUMAN });
  sim.world.add(e, JobAssignment, { workplace });
  return e;
}

function placeTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 4, harvestAtomic: WOOD_HARVEST });
  sim.world.add(e, Felling, { chopsLeft: CHOPS_TO_FELL });
  return e;
}

function placeStone(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: STONE, remaining: 5, harvestAtomic: STONE_HARVEST });
  return e;
}

function sceneSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 8) });
}

describe('employed gatherer — the workplace store filter', () => {
  it('forages only workplace-stored goods: skips a NEARER stone for the sawmill wood', () => {
    const sim = sceneSim();
    const mill = placeBuilding(sim, SAWMILL, 1, 1);
    const worker = employedCollector(sim, 8, 1, mill);
    const stone = placeStone(sim, 9, 1); // right beside the collector
    const tree = placeTree(sim, 14, 1); // farther away, but the only good the sawmill stores
    sim.run(200); // plenty to walk over and start felling
    expect(sim.world.get(stone, Resource).remaining).toBe(5); // untouched — not a sawmill ware
    // The wood was worked instead: the tree is being chopped (or already fell and was reaped).
    const chopped = !sim.world.isAlive(tree) || sim.world.get(tree, Felling).chopsLeft < CHOPS_TO_FELL;
    expect(chopped).toBe(true);
    expect(sim.world.has(worker, GatherSelection)).toBe(false); // no pick made — filter alone did this
  });

  it('an unemployed roamer keeps the old behaviour: takes the nearest node regardless of good', () => {
    const sim = sceneSim();
    const worker = settlerAt(sim, { jobType: COLLECTOR, position: { x: fx.fromInt(8), y: fx.fromInt(1) } });
    sim.world.add(worker, Owner, { player: HUMAN });
    const stone = placeStone(sim, 9, 1);
    placeTree(sim, 14, 1);
    sim.run(120);
    expect(sim.world.get(stone, Resource).remaining).toBeLessThan(5); // the nearer stone is mined
  });

  it('setGatherGood pins an employed gatherer to ONE stored good and null resets it', () => {
    const sim = sceneSim();
    const store = placeBuilding(sim, WAREHOUSE, 1, 1); // stocks wood AND stone
    const worker = employedCollector(sim, 8, 1, store);
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: worker, goodType: WOOD });
    expect(sim.world.get(worker, GatherSelection).goodType).toBe(WOOD);
    const stone = placeStone(sim, 9, 1);
    sim.run(120);
    expect(sim.world.get(stone, Resource).remaining).toBe(5); // pinned to wood — the stone is not its pick
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: worker, goodType: null });
    expect(sim.world.has(worker, GatherSelection)).toBe(false);
  });

  it('rejects a good the workplace does not store (recoverable bad input)', () => {
    const sim = sceneSim();
    const mill = placeBuilding(sim, SAWMILL, 1, 1);
    const worker = employedCollector(sim, 8, 1, mill);
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: worker, goodType: STONE });
    expect(sim.world.has(worker, GatherSelection)).toBe(false);
  });

  it('an employment change clears the pick (the selection was made under the old workplace)', () => {
    const sim = sceneSim();
    const store = placeBuilding(sim, WAREHOUSE, 1, 1);
    const worker = employedCollector(sim, 8, 1, store);
    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: worker, goodType: WOOD });
    expect(sim.world.has(worker, GatherSelection)).toBe(true);
    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: worker, jobType: WOODCUTTER });
    expect(sim.world.has(worker, GatherSelection)).toBe(false);
  });
});
