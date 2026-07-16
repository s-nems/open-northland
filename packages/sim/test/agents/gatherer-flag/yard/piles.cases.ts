import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Owner,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, nodeOfPosition, Simulation } from '../../../../src/index.js';
import { setWorkFlag } from '../../../../src/systems/index.js';
import { MAX_GROUND_STACK } from '../../../../src/systems/stores/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  ctxOf,
  grassMap,
  groundHeaps,
  groundHeapWood,
  makeWoodcutter,
  placeFellableTree,
  runTicks,
  TREE_WOOD_YIELD,
  WIDE_RADIUS,
  WOOD,
} from '../support.js';

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

  it('banks beside a blocked flag cell instead of routing into the obstacle forever', () => {
    const sim = new Simulation({ seed: 9, content: testContent(), map: grassMap(20, 3) });
    const gatherer = makeWoodcutter(sim, 1, 1);
    bindToFlag(sim, gatherer, 5, 1, WIDE_RADIUS);
    sim.world.add(gatherer, Carrying, { goodType: WOOD, amount: 1 });
    const blocker = sim.world.create();
    sim.world.add(blocker, Position, { x: fx.fromInt(5), y: fx.fromInt(1) });
    sim.world.add(blocker, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: 24 });
    sim.world.add(blocker, ResourceFootprint, {
      walk: [{ dx: 0, dy: 0 }],
      build: [{ dx: 0, dy: 0 }],
      work: [{ dx: -1, dy: 0 }],
      sourceGfxIndex: 1,
    });

    const violations = runTicks(sim, 400);

    expect(sim.world.has(gatherer, Carrying)).toBe(false);
    const heap = groundHeaps(sim)[0] as Entity;
    const heapNode = nodeOfPosition(sim.world.get(heap, Position).x, sim.world.get(heap, Position).y);
    expect(heapNode).not.toEqual({ hx: 10, hy: 2 });
    expect(violations).toEqual([]);
  });

  it('tries later yard nodes when dynamic resource blocks cut the flag off', () => {
    const sim = new Simulation({ seed: 11, content: testContent(), map: grassMap(20, 5) });
    const gatherer = makeWoodcutter(sim, 1, 1);
    bindToFlag(sim, gatherer, 8, 1, WIDE_RADIUS);
    sim.world.add(gatherer, Carrying, { goodType: WOOD, amount: 1 });
    const wall = sim.world.create();
    sim.world.add(wall, Position, { x: fx.fromInt(5), y: fx.fromInt(0) });
    sim.world.add(wall, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: 24 });
    sim.world.add(wall, ResourceFootprint, {
      walk: Array.from({ length: 5 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [{ dx: -1, dy: 0 }],
      sourceGfxIndex: 1,
    });

    const violations = runTicks(sim, 600);

    expect(sim.world.has(gatherer, Carrying)).toBe(false);
    const heap = groundHeaps(sim)[0] as Entity;
    const p = sim.world.get(heap, Position);
    expect(nodeOfPosition(p.x, p.y).hx).toBeLessThan(10); // reachable side of the wall
    expect(violations).toEqual([]);
  });

  it('does NOT move already-dropped goods when the flag is relocated (they never teleport)', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(40, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    sim.world.add(gatherer, Owner, { player: PLAYER });
    const flag = bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    placeFellableTree(sim, 1, 0);

    runTicks(sim, 900); // fell + carry + deliver: a heap forms at the flag tile (5,0)
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

  it('replans an in-flight delivery when the flag moves and banks at the new yard', () => {
    const sim = new Simulation({ seed: 10, content: testContent(), map: grassMap(40, 1) });
    const gatherer = makeWoodcutter(sim, 0, 0);
    sim.world.add(gatherer, Owner, { player: PLAYER });
    bindToFlag(sim, gatherer, 15, 0, WIDE_RADIUS);
    sim.world.add(gatherer, Carrying, { goodType: WOOD, amount: 1 });
    runTicks(sim, 5); // delivery route to the old flag is active

    setWorkFlag(sim.world, ctxOf(sim), { kind: 'setWorkFlag', entity: gatherer, ...nodeOfTile(5) });
    const violations = runTicks(sim, 400);

    expect(sim.world.has(gatherer, Carrying)).toBe(false);
    const heap = groundHeaps(sim)[0] as Entity;
    expect(fx.toInt(sim.world.get(heap, Position).x)).toBe(5);
    expect(violations).toEqual([]);
  });

  it('cancels an active pileup when the flag moves, then deposits at the new yard', () => {
    const sim = new Simulation({ seed: 12, content: testContent(), map: grassMap(40, 1) });
    const gatherer = makeWoodcutter(sim, 5, 0);
    sim.world.add(gatherer, Owner, { player: PLAYER });
    const flag = bindToFlag(sim, gatherer, 5, 0, WIDE_RADIUS);
    sim.world.add(gatherer, Carrying, { goodType: WOOD, amount: 1 });
    sim.world.add(gatherer, CurrentAtomic, {
      atomicId: 23,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 30,
      effect: { kind: 'pileup', store: flag },
      targetEntity: flag,
      targetTile: null,
    });

    setWorkFlag(sim.world, ctxOf(sim), { kind: 'setWorkFlag', entity: gatherer, ...nodeOfTile(15) });
    expect(sim.world.has(gatherer, CurrentAtomic)).toBe(false);
    const violations = runTicks(sim, 500);

    expect(sim.world.has(gatherer, Carrying)).toBe(false);
    const heap = groundHeaps(sim)[0] as Entity;
    expect(fx.toInt(sim.world.get(heap, Position).x)).toBe(15);
    expect(violations).toEqual([]);
  });
});
