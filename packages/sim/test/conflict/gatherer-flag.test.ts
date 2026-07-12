import { beforeEach, describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Felling,
  GroundDrop,
  HarvestedBy,
  Owner,
  Position,
  Resource,
  Settler,
  Stockpile,
  WorkFlag,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  checkInvariants,
  fx,
  nodeOfPosition,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import {
  aiSystem,
  atomicSystem,
  isYardHeap,
  type SystemContext,
  setWorkFlag,
} from '../../src/systems/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/stores.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

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
const WATER = 1; // landscape typeId flagged walkable:false in testContent — an impassable river cell
const WOOD = 1;
const WOODCUTTER = 1; // fixture job allowed the wood harvest atomic (24)
const VIKING = 1;
const HARVEST_ATOMIC = 24;
const WIDE_RADIUS = 40; // covers any node in these small strips
const NARROW_RADIUS = 4; // tight enough that a distant node falls outside it

const WOOD_GATHERING = testContent().goods.find((g) => g.id === 'wood')?.gathering;
const CHOPS_TO_FELL = WOOD_GATHERING?.chopsToFell ?? 0;
const TREE_WOOD_YIELD = WOOD_GATHERING?.yieldPerNode ?? 0;

beforeEach(clearComponentStores);

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

/** A grass half-cell map split by a vertical WATER wall on node columns `riverCols` (all rows) — a
 *  river with no crossing, so the nodes left and right of it are separate static components (the
 *  "mosty na rzece" precondition: bridges are not walkable, so the two banks never connect). */
function riverMap(width: number, height: number, riverCols: readonly number[]): TerrainMap {
  const typeIds = new Array(width * height).fill(GRASS);
  for (let hy = 0; hy < height; hy++) {
    for (const hx of riverCols) typeIds[hy * width + hx] = WATER;
  }
  return { resolution: 'half-cell', width, height, typeIds };
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

describe('flag-bound gatherer — never targets a tree it cannot reach (mosty na rzece)', () => {
  // A river of WATER nodes at columns 10,11 splits the map: left bank hx≤9, right bank hx≥12 (a single
  // water node kills the straight step and its diagonal flanks, so the banks are separate components).
  // Tile (tx,ty) sits at node (2·tx, 2·ty); a footprint-less tree's work cell is its own anchor node.
  const RIVER = [10, 11] as const;

  it('picks a reachable farther tree over the nearest one across the river (planner, one tick)', () => {
    // Flag@tile4 (node 8, left bank). The tree NEAREST the flag is @tile6 (node 12, RIGHT bank, dist 4) —
    // unreachable across the water. A reachable tree sits @tile1 (node 2, left bank, dist 6), and the
    // gatherer stands on it. Pre-fix the distance-only pick latched onto the node-12 tree and the gatherer
    // walked at the river forever; now the cross-component tree is skipped and it chops the reachable one.
    const sim = new Simulation({ seed: 1, content: testContent(), map: riverMap(28, 6, RIVER) });
    const gatherer = makeWoodcutter(sim, 1, 1); // stands on the reachable tree's cell
    bindToFlag(sim, gatherer, 4, 1, WIDE_RADIUS);
    const acrossRiver = placeFellableTree(sim, 6, 1); // nearest to the flag, but on the far bank
    const reachable = placeFellableTree(sim, 1, 1); // farther from the flag, same bank as the gatherer

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(gatherer, CurrentAtomic); // chose to CHOP this tick (no MoveGoal stall)
    expect(atomic.atomicId).toBe(HARVEST_ATOMIC);
    expect(atomic.effect.kind === 'harvest' && atomic.effect.resource).toBe(reachable);
    expect(atomic.effect.kind === 'harvest' && atomic.effect.resource).not.toBe(acrossRiver);
  });

  it('fells the reachable tree and banks it, leaving the across-river tree untouched (full run)', () => {
    // Same split, but the gatherer starts on its flag tile (node 8). The nearest tree to the flag is again
    // the unreachable node-12 tree; the reachable tree is @tile1 (node 2). Over a full run it must fell the
    // reachable one and never stall pointed at the far bank.
    const sim = new Simulation({ seed: 3, content: testContent(), map: riverMap(28, 6, RIVER) });
    const gatherer = makeWoodcutter(sim, 4, 1);
    bindToFlag(sim, gatherer, 4, 1, WIDE_RADIUS);
    const acrossRiver = placeFellableTree(sim, 6, 1); // nearest, unreachable
    placeFellableTree(sim, 1, 1); // farther, reachable — the one that gets worked

    const violations = runTicks(sim, 800);

    expect(groundHeapWood(sim)).toBe(TREE_WOOD_YIELD); // the reachable tree's wood banked at the flag
    const standing = [...sim.world.query(Resource)];
    expect(standing).toEqual([acrossRiver]); // only the far-bank tree still stands…
    expect(sim.world.get(acrossRiver, Felling).chopsLeft).toBe(CHOPS_TO_FELL); // …and it was never chopped
    // The gatherer never crossed the river — it stayed on its own (left) bank.
    expect(fx.toInt(sim.world.get(gatherer, Position).x)).toBeLessThanOrEqual(5);
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
