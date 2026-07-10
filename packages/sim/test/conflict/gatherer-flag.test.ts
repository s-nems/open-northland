import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Felling,
  GroundDrop,
  HarvestedBy,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Resource,
  Settler,
  Stockpile,
  Stump,
  WorkFlag,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  Simulation,
  type TerrainMap,
  checkInvariants,
  fx,
  nodeOfPosition,
} from '../../src/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/agents/effects-goods.js';
import {
  type SystemContext,
  aiSystem,
  atomicSystem,
  isYardHeap,
  setWorkFlag,
} from '../../src/systems/index.js';
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
    DeliveryFlag,
    Owner,
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

/** Bind `gatherer` to a fresh flag — a pure {@link DeliveryFlag} marker (NO Stockpile; the harvest piles on
 *  the ground around it) at tile (fx,fy). Returns the flag entity. */
function bindToFlag(
  sim: Simulation,
  gatherer: Entity,
  fxTile: number,
  fyTile: number,
  radius: number,
): Entity {
  const flag = sim.world.create();
  sim.world.add(flag, Position, { x: fx.fromInt(fxTile), y: fx.fromInt(fyTile) });
  sim.world.add(flag, DeliveryFlag, {});
  sim.world.add(gatherer, WorkFlag, { flag, radius });
  return flag;
}

/** The loose ground HEAPS a flag-bound gatherer stacks its harvest onto (the goods yard around the flag) —
 *  the shared {@link isYardHeap} predicate, the same one the sim + scene checks use. */
function groundHeaps(sim: Simulation): Entity[] {
  return [...sim.world.query(Stockpile)].filter((e) => isYardHeap(sim.world, e));
}

/** Total WOOD across the goods-yard heaps (see {@link groundHeaps}). */
function groundHeapWood(sim: Simulation): number {
  return groundHeaps(sim).reduce((sum, e) => sum + (sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0), 0);
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
  it('delivers its felled wood to a heap by its bound flag, not the nearer warehouse', () => {
    // gatherer@0, tree@1 (in radius), a warehouse@2 (nearer), the bound flag@4 (farther).
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(8, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    const flag = bindToFlag(sim, gatherer, 4, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0);
    const warehouse = makeStore(sim, 2, 0); // a closer capable store — the tempting wrong sink

    const violations = runTicks(sim, 600);

    // The whole yield landed as a ground heap by the flag; the nearer warehouse never received a unit; the
    // flag itself stores NOTHING (a pure marker — the goods sit on the ground beside it).
    expect(groundHeapWood(sim)).toBe(TREE_WOOD_YIELD);
    expect(storeWood(sim, warehouse)).toBe(0);
    expect(sim.world.has(flag, Stockpile)).toBe(false);
    // The tree is felled and its trunk fully carried off (the yard heap is not a GroundDrop).
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
    bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0); // its own work, in radius
    const loose = makeLooseTrunk(sim, 8, 0, TREE_WOOD_YIELD); // in radius, but not its own — must be ignored

    const violations = runTicks(sim, 600);

    expect(groundHeapWood(sim)).toBe(TREE_WOOD_YIELD); // exactly its own tree's yield piled by the flag, no more
    expect(storeWood(sim, loose)).toBe(TREE_WOOD_YIELD); // the foreign pile is left in peace
    expect(sim.world.has(loose, GroundDrop)).toBe(true); // still an untouched, uncollected trunk
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
    bindToFlag(sim, gatherer, 1, 0, NARROW_RADIUS);
    placeFellableTree(sim, 20, 0);

    const violations = runTicks(sim, 200);

    // The out-of-range tree is never chopped, nothing is banked, and the gatherer stayed home by its flag.
    expect([...sim.world.query(Resource)]).toHaveLength(1);
    expect(sim.world.get([...sim.world.query(Felling)][0] as Entity, Felling).chopsLeft).toBe(CHOPS_TO_FELL);
    expect(groundHeapWood(sim)).toBe(0); // no harvest ⇒ no goods heaps by the flag
    expect(fx.toInt(sim.world.get(gatherer, Position).x)).toBeLessThanOrEqual(NARROW_RADIUS);
    expect(violations).toEqual([]);
  });
});

describe('setWorkFlag command — place / move a gatherer flag (Ctrl+Right-Click)', () => {
  const PLAYER = 0;
  // A node at half-cell coords of tile (t,0): node (2t, 0).
  const nodeOfTile = (t: number): { x: number; y: number } => ({ x: 2 * t, y: 0 });

  function ownedGatherer(sim: Simulation, x: number, y: number): Entity {
    const e = makeWoodcutter(sim, x, y);
    sim.world.add(e, Owner, { player: PLAYER });
    return e;
  }
  const cmd = (entity: Entity, tile: number): Extract<Command, { kind: 'setWorkFlag' }> => ({
    kind: 'setWorkFlag',
    entity,
    ...nodeOfTile(tile),
  });

  it('creates a bound, DeliveryFlag-marked flag at the target for a gatherer with none', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    expect(sim.world.has(g, WorkFlag)).toBe(false);

    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 6));

    expect(sim.world.has(g, WorkFlag)).toBe(true);
    const wf = sim.world.get(g, WorkFlag);
    expect(sim.world.has(wf.flag, DeliveryFlag)).toBe(true); // marked so render draws the flag above goods
    expect(sim.world.has(wf.flag, Stockpile)).toBe(false); // a PURE marker — it stores nothing
    expect(fx.toInt(sim.world.get(wf.flag, Position).x)).toBe(6);
    expect(wf.radius).toBeGreaterThan(0);
  });

  it('RELOCATES the existing flag (same entity, new position) rather than making a second', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 5));
    const flag = sim.world.get(g, WorkFlag).flag;

    setWorkFlag(sim.world, ctxOf(sim), cmd(g, 11));

    expect(sim.world.get(g, WorkFlag).flag).toBe(flag); // same flag entity…
    expect(fx.toInt(sim.world.get(flag, Position).x)).toBe(11); // …moved to the new tile
    expect([...sim.world.query(DeliveryFlag)]).toHaveLength(1); // no second flag littered
  });

  it('skips an UNOWNED gatherer, a jobless settler, and a non-settler (only an owned gatherer gets a flag)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const unowned = makeWoodcutter(sim, 0, 0); // a gatherer, but no Owner
    const jobless = sim.world.create();
    sim.world.add(jobless, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(jobless, Settler, {
      tribe: VIKING,
      jobType: null, // employed at nothing → cannot harvest → no flag
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    sim.world.add(jobless, Owner, { player: PLAYER });
    const rock = sim.world.create(); // a non-settler entity

    setWorkFlag(sim.world, ctxOf(sim), cmd(unowned, 6));
    setWorkFlag(sim.world, ctxOf(sim), cmd(jobless, 6));
    setWorkFlag(sim.world, ctxOf(sim), cmd(rock, 6));

    expect(sim.world.has(unowned, WorkFlag)).toBe(false);
    expect(sim.world.has(jobless, WorkFlag)).toBe(false);
    expect([...sim.world.query(DeliveryFlag)]).toHaveLength(0); // nothing planted
  });

  it('routes through the command dispatch (enqueue → step) end to end', () => {
    const sim = new Simulation({ seed: 4, content: testContent(), map: grassMap(40, 1) });
    const g = ownedGatherer(sim, 0, 0);
    sim.enqueue(cmd(g, 6));
    sim.step();
    expect(sim.world.has(g, WorkFlag)).toBe(true);
    expect(fx.toInt(sim.world.get(sim.world.get(g, WorkFlag).flag, Position).x)).toBe(6);
  });
});

describe('flag-bound gatherer — goods pile on the GROUND, capped and pinned (not on the flag)', () => {
  const PLAYER = 0;
  const nodeOfTile = (t: number): { x: number; y: number } => ({ x: 2 * t, y: 0 });

  it('spills a full tile onto the ADJACENT half-cell, capped and tile-to-tile (no gaps, no teleport)', () => {
    // Two trees in radius (2·yield = 8 wood > the 5-per-tile cap): the flag tile fills to 5, the spill lands
    // on the NEXT half-cell node over — capped heaps packed side by side, not scattered a full tile apart.
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(20, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0);
    placeFellableTree(sim, 2, 0);

    const violations = runTicks(sim, 2000);

    const heaps = groundHeaps(sim);
    const total = 2 * TREE_WOOD_YIELD;
    expect(groundHeapWood(sim)).toBe(total); // every unit banked on the ground
    expect(heaps.length).toBe(Math.ceil(total / MAX_GROUND_STACK)); // spilled into the fewest capped heaps
    for (const h of heaps) {
      expect(sim.world.get(h, Stockpile).amounts.get(WOOD) ?? 0).toBeLessThanOrEqual(MAX_GROUND_STACK);
    }
    // The two heaps sit on ADJACENT half-cell nodes (node distance 1) — packed tile-to-tile on the lattice,
    // not a full cell (distance 2) apart with a settler-sized gap between them.
    const nodes = heaps.map((h) => {
      const p = sim.world.get(h, Position);
      return nodeOfPosition(p.x, p.y);
    });
    const [a, b] = nodes as [{ hx: number; hy: number }, { hx: number; hy: number }];
    expect(Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy)).toBe(1);
    expect(violations).toEqual([]);
  });

  it('re-fills a drained (0-unit) yard heap instead of stalling on it (no livelock)', () => {
    // A porter can empty a yard heap to {WOOD:0} (a bare pile, so nothing auto-removed it in this fixture).
    // The gatherer must be able to top that same tile back up — not read it as "a different good" and freeze
    // carrying its load forever. Pre-seed the drained heap on the flag's own yard tile, then harvest+deliver.
    const sim = new Simulation({ seed: 8, content: testContent(), map: grassMap(20, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    const drained = sim.world.create();
    sim.world.add(drained, Position, { x: fx.fromInt(5), y: fx.fromInt(0) }); // the flag tile's yard node
    sim.world.add(drained, Stockpile, { amounts: new Map([[WOOD, 0]]) });
    placeFellableTree(sim, 1, 0);

    const violations = runTicks(sim, 800);

    const heaps = groundHeaps(sim);
    expect(heaps).toHaveLength(1); // topped up the SAME drained heap, not littered a second
    expect(heaps[0]).toBe(drained);
    expect(groundHeapWood(sim)).toBe(TREE_WOOD_YIELD); // the load was actually banked, not stuck on its back
    expect(sim.world.has(gatherer, Carrying)).toBe(false); // hands free — no livelock
    expect(violations).toEqual([]);
  });

  it('does NOT move already-dropped goods when the flag is relocated (they never teleport)', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(40, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    sim.world.add(gatherer, Owner, { player: PLAYER });
    const flag = bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0);

    runTicks(sim, 600); // fell + carry + deliver: a heap forms at the flag tile (5,0)
    const heaps = groundHeaps(sim);
    expect(heaps).toHaveLength(1);
    const heap = heaps[0] as Entity;
    const heapX = fx.toInt(sim.world.get(heap, Position).x);
    const heapFill = sim.world.get(heap, Stockpile).amounts.get(WOOD) ?? 0;
    expect(heapX).toBe(5); // dropped by the flag's original spot
    expect(heapFill).toBe(TREE_WOOD_YIELD);

    // Relocate the flag far away — only the MARKER moves; the goods stay pinned to their tile.
    setWorkFlag(sim.world, ctxOf(sim), { kind: 'setWorkFlag', entity: gatherer, ...nodeOfTile(15) });

    expect(fx.toInt(sim.world.get(flag, Position).x)).toBe(15); // the flag moved…
    expect(fx.toInt(sim.world.get(heap, Position).x)).toBe(heapX); // …but the heap did NOT follow it
    expect(sim.world.get(heap, Stockpile).amounts.get(WOOD) ?? 0).toBe(heapFill);
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
