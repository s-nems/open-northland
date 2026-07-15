import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Felling,
  GroundDrop,
  MoveGoal,
  Position,
  Resource,
  Stockpile,
  Stump,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { CORE_INVARIANTS, checkInvariants, fx, Simulation } from '../../src/index.js';
import { aiSystem, atomicSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * FAITHFUL MULTI-HIT HARVEST + DROP-ON-GROUND (historical plan phase 3). A wood node is FELLED, not gathered
 * unit-by-unit: the collector chops it down over `chopsToFell` swings (each yielding NOTHING onto its
 * back), then the tree falls — the standing node is removed, its whole `yieldPerNode` yield drops at
 * its cell as a bare {@link GroundDrop} trunk pile, and a {@link Stump} decor is left behind. The
 * collector then carries the trunk off to a store (multiple trips at a 1-unit on-foot carry). Goods
 * are conserved: nothing is created or lost by the tree coming down.
 *
 * The felling constants come from CONTENT (the wood good's `gathering.chopsToFell`/`yieldPerNode`,
 * OBSERVED calibration values — source basis), read here so the tests carry no magic literals.
 */

const WOOD = 1;
const WOODCUTTER = 1; // fixture job allowed the wood harvest atomic (24)
const VIKING = 1;
const HARVEST_ATOMIC = 24;

// The felling spec the sim stamps onto a fellable node — read from the fixture, not hardcoded.
const WOOD_GATHERING = testContent().goods.find((g) => g.id === 'wood')?.gathering;
const CHOPS_TO_FELL = WOOD_GATHERING?.chopsToFell ?? 0;
const TREE_WOOD_YIELD = WOOD_GATHERING?.yieldPerNode ?? 0;

/** A proper woodcutter settler at integer tile (x,y): needs at 0, empty experience. */
function makeWoodcutter(sim: Simulation, x: number, y: number): Entity {
  return settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
}

/** A standing FELLABLE wood node at (x,y): the felling spec (chops + whole yield) comes from content. */
function placeFellableTree(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: TREE_WOOD_YIELD, harvestAtomic: HARVEST_ATOMIC });
  sim.world.add(e, Felling, { chopsLeft: CHOPS_TO_FELL });
  return e;
}

/** Start (and immediately let complete, duration 1) a single chop of `node` by `settler`. */
function chopOnce(sim: Simulation, settler: Entity, node: Entity): void {
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

/** Every entity that carries a {@link Stump}. */
function stumps(sim: Simulation): Entity[] {
  return [...sim.world.query(Stump)];
}

/** The single ground trunk (a {@link GroundDrop} pile), or undefined if none is present. */
function trunkPile(sim: Simulation): Entity | undefined {
  return [...sim.world.query(GroundDrop)][0];
}

/** Total materialised wood in the world: every stockpile's wood + every carried wood load. The
 *  conservation yardstick — before the tree falls this is 0, after it is exactly the tree's yield. */
function totalWood(sim: Simulation): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) total += sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
  for (const e of sim.world.query(Carrying)) {
    const c = sim.world.get(e, Carrying);
    if (c.goodType === WOOD) total += c.amount;
  }
  return total;
}

describe('felling — chopping a tree down', () => {
  it('the fixture pins a real felling spec (chops + yield both positive)', () => {
    expect(CHOPS_TO_FELL).toBeGreaterThan(0);
    expect(TREE_WOOD_YIELD).toBeGreaterThan(0);
  });

  it('a chop decrements chopsLeft and yields NOTHING onto the back', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tree = placeFellableTree(sim, 0, 0);
    const cutter = makeWoodcutter(sim, 0, 0);

    chopOnce(sim, cutter, tree);

    expect(sim.world.get(tree, Felling).chopsLeft).toBe(CHOPS_TO_FELL - 1);
    expect(sim.world.has(cutter, Carrying)).toBe(false); // a chop carries nothing until the tree falls
    expect(sim.world.has(tree, Resource)).toBe(true); // still standing (more chops to go)
    expect(trunkPile(sim)).toBeUndefined();
    expect(stumps(sim)).toHaveLength(0);
  });

  it('the last chop fells the node: it is removed, a trunk pile + stump appear, still nothing carried', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tree = placeFellableTree(sim, 3, 0);
    const cutter = makeWoodcutter(sim, 3, 0);
    sim.events.clear();

    for (let i = 0; i < CHOPS_TO_FELL; i++) chopOnce(sim, cutter, tree);

    // The standing node is gone entirely — the planner never re-scans a depleted stump-to-be.
    expect(sim.world.has(tree, Resource)).toBe(false);
    expect(sim.world.has(tree, Felling)).toBe(false);
    // A trunk pile holding the WHOLE yield sits at the node's cell, marked GroundDrop.
    const trunk = trunkPile(sim);
    expect(trunk).toBeDefined();
    const trunkE = trunk as Entity;
    expect(sim.world.get(trunkE, Stockpile).amounts.get(WOOD)).toBe(TREE_WOOD_YIELD);
    expect(fx.toInt(sim.world.get(trunkE, Position).x)).toBe(3);
    // A stump decor is left where the tree stood.
    expect(stumps(sim)).toHaveLength(1);
    expect(fx.toInt(sim.world.get(stumps(sim)[0] as Entity, Position).x)).toBe(3);
    // The feller still carries nothing (it will pick the trunk up next, as the collector).
    expect(sim.world.has(cutter, Carrying)).toBe(false);
    // Goods conserved: the trunk holds exactly the tree's whole yield, no more, no less.
    expect(totalWood(sim)).toBe(TREE_WOOD_YIELD);
  });

  it('emits a resourceFelled event naming the trunk, the stump, and the whole yield', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const tree = placeFellableTree(sim, 2, 0);
    const cutter = makeWoodcutter(sim, 2, 0);

    for (let i = 0; i < CHOPS_TO_FELL - 1; i++) {
      sim.events.clear();
      chopOnce(sim, cutter, tree);
      expect(sim.events.current().some((ev) => ev.kind === 'resourceFelled')).toBe(false); // not yet
    }
    sim.events.clear();
    chopOnce(sim, cutter, tree); // the felling chop

    const felled = sim.events.current().filter((ev) => ev.kind === 'resourceFelled');
    expect(felled).toHaveLength(1);
    expect(felled[0]).toMatchObject({
      kind: 'resourceFelled',
      node: tree,
      goodType: WOOD,
      amount: TREE_WOOD_YIELD,
      at: { x: 4, y: 0 }, // half-cell node of tile (2,0) — every event `at` is a node
    });
  });
});

describe('felling — ground drop cleanup', () => {
  it('a GroundDrop trunk is reaped once a pickup empties it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const pile = sim.world.create();
    sim.world.add(pile, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(pile, Stockpile, { amounts: new Map([[WOOD, 1]]) });
    sim.world.add(pile, GroundDrop, { goodType: WOOD });
    const cutter = makeWoodcutter(sim, 0, 0);
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: 22,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'pickup', goodType: WOOD, amount: 1, from: pile },
      targetEntity: pile,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(pile, Stockpile)).toBe(false); // emptied drop vanished
    expect(sim.world.get(cutter, Carrying).amount).toBe(1); // the unit moved onto the collector
  });

  it('a bare loose HEAP (no GroundDrop marker) is ALSO reaped once emptied — no zombie zero-heap', () => {
    // A gatherer-yard / player-dropped heap carries no marker; when a pickup drains it, it must vanish like a
    // trunk does (a lingering {WOOD:0} heap would mis-render as a flag and read as "free but unfillable").
    const sim = new Simulation({ seed: 1, content: testContent() });
    const heap = sim.world.create();
    sim.world.add(heap, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(heap, Stockpile, { amounts: new Map([[WOOD, 1]]) }); // a loose yard heap, no marker
    const cutter = makeWoodcutter(sim, 0, 0);
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: 22,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'pickup', goodType: WOOD, amount: 1, from: heap },
      targetEntity: heap,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(heap, Stockpile)).toBe(false); // emptied loose heap vanished
    expect(sim.world.get(cutter, Carrying).amount).toBe(1);
  });

  it('a persistent STORE (a Building warehouse) is NOT reaped when emptied — it stays open for deposits', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(store, Building, { buildingType: 1, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[WOOD, 1]]) });
    const cutter = makeWoodcutter(sim, 0, 0);
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: 22,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'pickup', goodType: WOOD, amount: 1, from: store },
      targetEntity: store,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(store, Stockpile)).toBe(true); // the warehouse persists as a collection point
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
  });
});

describe('felling — the planner fell-vs-collect split', () => {
  it('a collector standing on its fresh trunk picks the wood up rather than walking to a distant tree', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // A collectable trunk right under the woodcutter, a standing tree far to the right.
    const trunk = sim.world.create();
    sim.world.add(trunk, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
    sim.world.add(trunk, Stockpile, { amounts: new Map([[WOOD, TREE_WOOD_YIELD]]) });
    sim.world.add(trunk, GroundDrop, { goodType: WOOD });
    placeFellableTree(sim, 6, 0);
    const cutter = makeWoodcutter(sim, 2, 0);

    aiSystem(sim.world, ctxOf(sim));

    // It started a pickup of the trunk it stands on — not a MoveGoal toward the far tree.
    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.effect.kind).toBe('pickup');
    expect(atomic.effect.kind === 'pickup' && atomic.effect.from).toBe(trunk);
  });

  it('with no trunk in reach, a collector standing on a tree chops it (starts the harvest atomic)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const tree = placeFellableTree(sim, 3, 0);
    const cutter = makeWoodcutter(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.atomicId).toBe(HARVEST_ATOMIC);
    expect(atomic.effect.kind).toBe('harvest');
    expect(atomic.effect.kind === 'harvest' && atomic.effect.resource).toBe(tree);
  });
});

describe('felling — end-to-end through the real schedule', () => {
  it('a woodcutter fells a tree and delivers exactly its yield to the store; goods are conserved', () => {
    // Strip: woodcutter@0, a fellable tree@3, a warehouse store@4 (a real typed store — a delivery sink
    // must be a Building/Vehicle, never a bare loose pile).
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(6, 1) });
    makeWoodcutter(sim, 0, 0);
    placeFellableTree(sim, 3, 0);
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(4), y: fx.fromInt(0) });
    sim.world.add(store, Building, { buildingType: 7, tribe: VIKING, built: fx.fromInt(1), level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map<number, number>() });

    let maxWood = 0;
    const violations: string[] = [];
    for (let i = 0; i < 300; i++) {
      sim.step();
      maxWood = Math.max(maxWood, totalWood(sim));
      if (violations.length === 0) {
        const v = checkInvariants(sim.world, CORE_INVARIANTS);
        if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
      }
    }

    // The store holds exactly the tree's whole yield…
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(TREE_WOOD_YIELD);
    // …the standing node is gone, a stump remains, the drained trunk was reaped…
    expect([...sim.world.query(Resource)]).toHaveLength(0);
    expect(stumps(sim)).toHaveLength(1);
    expect([...sim.world.query(GroundDrop)]).toHaveLength(0);
    // …goods were conserved throughout: total wood never exceeded the tree's yield (no dupes), and all
    // of it ended in the store.
    expect(maxWood).toBe(TREE_WOOD_YIELD);
    expect(totalWood(sim)).toBe(TREE_WOOD_YIELD);
    expect(violations).toEqual([]);
  });
});
