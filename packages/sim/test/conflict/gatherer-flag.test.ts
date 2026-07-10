import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Felling,
  GroundDrop,
  HarvestedBy,
  JobAssignment,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
  Stump,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, Simulation, type TerrainMap, checkInvariants, fx } from '../../src/index.js';
import { type SystemContext, aiSystem, atomicSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * THE FLAG-BOUND GATHERER (user-specified behaviour): each gatherer is bound to its own flag ({@link
 * WorkFlag}) and, unlike an unbound roaming collector, it
 *
 *  1. carries every good it harvests to THAT flag (not merely the nearest store),
 *  2. carries off ONLY the trunks/ore it dug itself ({@link HarvestedBy}) — a loose pile it did not make is
 *     left in peace,
 *  3. looks for work ONLY within its flag's radius, standing idle beside the flag when nothing is in reach.
 *
 * A gatherer WITHOUT a WorkFlag keeps the prior roam-and-haul behaviour (proven in felling.test.ts); the
 * ownership mark is stamped only for flag-bound harvesters, so that older behaviour — and every golden — is
 * byte-identical. Distances are on the half-cell lattice: a bare fixture at tile f sits at node 2f (row 0),
 * an unfootprinted node's work cell is its own anchor node, so flag→node distance is exactly 2·|f−t|.
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1; // fixture job allowed the wood harvest atomic (24)
const VIKING = 1;
const HARVEST_ATOMIC = 24;
const WIDE_RADIUS = 40; // covers any node in these small strips
const NARROW_RADIUS = 4; // tight enough that a distant node falls outside it

const WOOD_GATHERING = testContent().goods.find((g) => g.id === 'wood')?.gathering;
const CHOPS_TO_FELL = WOOD_GATHERING?.chopsToFell ?? 0;
const TREE_WOOD_YIELD = WOOD_GATHERING?.yieldPerNode ?? 0;

function clearStores(): void {
  for (const c of [
    Position,
    Settler,
    Resource,
    Felling,
    Stump,
    GroundDrop,
    HarvestedBy,
    WorkFlag,
    Building,
    Stockpile,
    Carrying,
    CurrentAtomic,
    MoveGoal,
    PathFollow,
    PathRequest,
    JobAssignment,
  ]) {
    c.store.clear();
  }
}

beforeEach(clearStores);

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** A woodcutter settler at tile (x,y). Add a {@link WorkFlag} to make it flag-bound. */
function makeWoodcutter(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

/** Bind `gatherer` to a fresh flag (a bare uncapped stockpile) at tile (fx,fy); returns the flag entity. */
function bindToFlag(
  sim: Simulation,
  gatherer: Entity,
  fxTile: number,
  fyTile: number,
  radius: number,
): Entity {
  const flag = sim.world.create();
  sim.world.add(flag, Position, { x: fx.fromInt(fxTile), y: fx.fromInt(fyTile) });
  sim.world.add(flag, Stockpile, { amounts: new Map<number, number>() });
  sim.world.add(gatherer, WorkFlag, { flag, radius });
  return flag;
}

/** A bare uncapped store (a warehouse) at tile (x,y). */
function makeStore(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

/** A standing FELLABLE wood node at (x,y). */
function placeFellableTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: TREE_WOOD_YIELD, harvestAtomic: HARVEST_ATOMIC });
  sim.world.add(e, Felling, { chopsLeft: CHOPS_TO_FELL });
  return e;
}

/** A LOOSE trunk pile lying on the ground with no owner — the "jakis lezy" heap a gatherer must ignore. */
function makeLooseTrunk(sim: Simulation, x: number, y: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, amount]]) });
  sim.world.add(e, GroundDrop, { goodType: WOOD });
  return e;
}

function storeWood(sim: Simulation, store: Entity): number {
  return sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0;
}

function trunkPile(sim: Simulation): Entity | undefined {
  return [...sim.world.query(GroundDrop)][0];
}

function runTicks(sim: Simulation, ticks: number): string[] {
  const violations: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (violations.length === 0) {
      const v = checkInvariants(sim.world, CORE_INVARIANTS);
      if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
  }
  return violations;
}

describe('flag-bound gatherer — banks its harvest at its own flag (req 1)', () => {
  it('delivers its felled wood to its bound flag, not the nearer warehouse', () => {
    // gatherer@0, tree@1 (in radius), a warehouse@2 (nearer), the bound flag@4 (farther).
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(8, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    const flag = bindToFlag(sim, gatherer, 4, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0);
    const warehouse = makeStore(sim, 2, 0); // a closer capable store — the tempting wrong sink

    const violations = runTicks(sim, 600);

    // The whole yield reached the bound flag; the nearer warehouse never received a unit.
    expect(storeWood(sim, flag)).toBe(TREE_WOOD_YIELD);
    expect(storeWood(sim, warehouse)).toBe(0);
    // The tree is felled and its trunk fully carried off.
    expect([...sim.world.query(Resource)]).toHaveLength(0);
    expect([...sim.world.query(GroundDrop)]).toHaveLength(0);
    expect(violations).toEqual([]);
  });
});

describe('flag-bound gatherer — carries only what it dug (req 2)', () => {
  it('a flag-bound feller stamps its trunk with its own ownership', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    const tree = placeFellableTree(sim, 0, 0);

    for (let i = 0; i < CHOPS_TO_FELL; i++) chopFully(sim, gatherer, tree);

    const trunk = trunkPile(sim) as Entity;
    expect(trunk).toBeDefined();
    expect(sim.world.has(trunk, HarvestedBy)).toBe(true);
    expect(sim.world.get(trunk, HarvestedBy).by).toBe(gatherer); // its OWN trunk, marked to reclaim
  });

  it('a flagless feller leaves its trunk unowned (keeps the roaming path + goldens byte-identical)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const cutter = makeWoodcutter(sim, 0, 0); // NO WorkFlag
    const tree = placeFellableTree(sim, 0, 0);

    for (let i = 0; i < CHOPS_TO_FELL; i++) chopFully(sim, cutter, tree);

    const trunk = trunkPile(sim) as Entity;
    expect(trunk).toBeDefined();
    expect(sim.world.has(trunk, HarvestedBy)).toBe(false); // ownership is inert without a flag
  });

  it('ignores a loose trunk under its feet and chops its own tree instead', () => {
    // A tempting loose trunk right under the gatherer, its own tree at the same tile: the OLD behaviour
    // grabs the nearer loose trunk; the flag-bound gatherer leaves it and harvests.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    bindToFlag(sim, gatherer, 6, 0, WIDE_RADIUS);
    const loose = makeLooseTrunk(sim, 0, 0, TREE_WOOD_YIELD); // not this gatherer's — leave it alone
    const tree = placeFellableTree(sim, 0, 0);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(gatherer, CurrentAtomic);
    expect(atomic.effect.kind).toBe('harvest'); // it chose to CHOP, not to pick up the loose trunk
    expect(atomic.effect.kind === 'harvest' && atomic.effect.resource).toBe(tree);
    expect(storeWood(sim, loose)).toBe(TREE_WOOD_YIELD); // the loose pile is untouched
  });

  it('never touches a foreign loose pile over a full run — only its own tree reaches the flag', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(12, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    const flag = bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0); // its own work, in radius
    const loose = makeLooseTrunk(sim, 8, 0, TREE_WOOD_YIELD); // in radius, but not its own — must be ignored

    const violations = runTicks(sim, 600);

    expect(storeWood(sim, flag)).toBe(TREE_WOOD_YIELD); // exactly its own tree's yield, no more
    expect(storeWood(sim, loose)).toBe(TREE_WOOD_YIELD); // the foreign pile is left in peace
    expect(sim.world.has(loose, Stockpile)).toBe(true); // never collected / reaped
    expect(violations).toEqual([]);
  });
});

describe('flag-bound gatherer — works only within its flag radius (req 3)', () => {
  it('harvests a tree inside the radius', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const gatherer = makeWoodcutter(sim, 3, 0);
    bindToFlag(sim, gatherer, 1, 0, WIDE_RADIUS);
    const tree = placeFellableTree(sim, 3, 0); // dist from flag@1 = 2·|1−3| = 4 ≤ radius

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(gatherer, CurrentAtomic);
    expect(atomic.atomicId).toBe(HARVEST_ATOMIC);
    expect(atomic.effect.kind === 'harvest' && atomic.effect.resource).toBe(tree);
  });

  it('ignores a tree beyond the radius and never fells it — it idles by the flag', () => {
    // flag@1, radius 4; the only tree is @20 (dist 38 ≫ radius). The gatherer must never roam out to it.
    const sim = new Simulation({ seed: 2, content: testContent(), map: grassMap(24, 1) });
    const gatherer = makeWoodcutter(sim, 1, 0);
    const flag = bindToFlag(sim, gatherer, 1, 0, NARROW_RADIUS);
    placeFellableTree(sim, 20, 0);

    const violations = runTicks(sim, 200);

    // The out-of-range tree is never chopped, nothing is banked, and the gatherer stayed home by its flag.
    expect([...sim.world.query(Resource)]).toHaveLength(1);
    expect(sim.world.get([...sim.world.query(Felling)][0] as Entity, Felling).chopsLeft).toBe(CHOPS_TO_FELL);
    expect(storeWood(sim, flag)).toBe(0);
    expect(fx.toInt(sim.world.get(gatherer, Position).x)).toBeLessThanOrEqual(NARROW_RADIUS);
    expect(violations).toEqual([]);
  });
});

/** Start (and immediately complete, duration 1) a single chop of `node` by `settler` — isolated to the
 *  AtomicSystem so the planner never re-tasks the settler between chops. */
function chopFully(sim: Simulation, settler: Entity, node: Entity): void {
  sim.world.add(settler, CurrentAtomic, {
    atomicId: HARVEST_ATOMIC,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: 1,
    effect: { kind: 'harvest', resource: node, goodType: WOOD },
    targetEntity: node,
    targetTile: null,
  });
  atomicSystem(sim.world, ctxOf(sim));
}
