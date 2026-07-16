import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Felling,
  Owner,
  Position,
  Resource,
  WorkFlag,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { aiSystem, setGatherGood } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  CHOPS_TO_FELL,
  ctxOf,
  grassMap,
  groundHeapWood,
  HARVEST_ATOMIC,
  makeWoodcutter,
  NARROW_RADIUS,
  placeFellableTree,
  riverMap,
  runTicks,
  TREE_WOOD_YIELD,
  WIDE_RADIUS,
} from '../support.js';

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

  it('harvests only the selected good, while all mode restores the ordinary nearest pick', () => {
    const base = testContent();
    const content = {
      ...base,
      jobs: base.jobs.map((job) =>
        job.typeId === 1 ? { ...job, allowedAtomics: [...job.allowedAtomics, 25] } : job,
      ),
    };
    const sim = new Simulation({ seed: 4, content, map: grassMap(8, 1) });
    const gatherer = makeWoodcutter(sim, 2, 0);
    sim.world.add(gatherer, Owner, { player: 0 });
    bindToFlag(sim, gatherer, 2, 0, WIDE_RADIUS);
    const wood = placeFellableTree(sim, 2, 0);
    const stone = sim.world.create();
    sim.world.add(stone, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
    sim.world.add(stone, Resource, { goodType: 4, remaining: 2, harvestAtomic: 25 });

    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: 4 });
    expect(sim.world.get(gatherer, WorkFlag).goodType).toBe(4);
    aiSystem(sim.world, ctxOf(sim));
    const filtered = sim.world.get(gatherer, CurrentAtomic);
    expect(filtered.effect.kind === 'harvest' && filtered.effect.resource).toBe(stone);

    setGatherGood(sim.world, ctxOf(sim), { kind: 'setGatherGood', entity: gatherer, goodType: null });
    aiSystem(sim.world, ctxOf(sim));
    const all = sim.world.get(gatherer, CurrentAtomic);
    expect(all.effect.kind === 'harvest' && all.effect.resource).toBe(wood);
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
