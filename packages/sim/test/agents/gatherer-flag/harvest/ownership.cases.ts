import { describe, expect, it } from 'vitest';
import { CurrentAtomic, GroundDrop, HarvestedBy } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { aiSystem } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  CHOPS_TO_FELL,
  chopFully,
  ctxOf,
  grassMap,
  groundHeapWood,
  makeLooseTrunk,
  makeWoodcutter,
  placeFellableTree,
  runTicks,
  storeWood,
  TREE_WOOD_YIELD,
  trunkPile,
  WIDE_RADIUS,
} from '../support.js';

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

    const violations = runTicks(sim, 900);

    expect(groundHeapWood(sim)).toBe(TREE_WOOD_YIELD); // exactly its own tree's yield piled by the flag, no more
    expect(storeWood(sim, loose)).toBe(TREE_WOOD_YIELD); // the foreign pile is left in peace
    expect(sim.world.has(loose, GroundDrop)).toBe(true); // still an untouched, uncollected trunk
    expect(violations).toEqual([]);
  });
});
