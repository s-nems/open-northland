import { describe, expect, it } from 'vitest';
import { GroundDrop, Resource, Stockpile } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  grassMap,
  groundHeapWood,
  makeStore,
  makeWoodcutter,
  placeFellableTree,
  runTicks,
  storeWood,
  TREE_WOOD_YIELD,
  WIDE_RADIUS,
} from '../support.js';

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
