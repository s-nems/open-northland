import { describe, expect, it } from 'vitest';
import { Carrying, Resource, Stockpile } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassMap, storeAt, WOOD, woodAt, woodcutterAt } from './support.js';

describe('atomicPlanner — end-to-end harvest -> carry -> pileup through the real schedule', () => {
  it('a woodcutter walks to wood, harvests, walks to the store, and piles it up', () => {
    // Layout on a 1-row grass strip: cutter at 0, wood at 1, store at 2 (short hops keep it fast).
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 1, 0, 5);
    const store = storeAt(sim, 2, 0);

    // Run until the store has wood (one full harvest→carry→pileup cycle), with a generous cap.
    let deposited = 0;
    for (let i = 0; i < 60 && deposited === 0; i++) {
      sim.step();
      deposited = sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0;
    }

    expect(deposited).toBe(1); // exactly one unit harvested and deposited
    expect(sim.world.has(cutter, Carrying)).toBe(false); // unloaded at the store
  });

  it('keeps cycling: a second unit lands in the store on a longer run', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    woodcutterAt(sim, 0, 0);
    woodAt(sim, 1, 0, 5);
    const store = storeAt(sim, 2, 0);
    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('depletes a finite node: a 3-unit node empties, is removed, and exactly 3 units reach the store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    const node = woodAt(sim, 1, 0, 3); // a bare (non-felling) node with only three units to give

    const store = storeAt(sim, 2, 0);

    // Long enough to harvest the node dry and haul every unit (each cycle is ~tens of ticks).
    for (let i = 0; i < 600; i++) sim.step();

    // A drained single-unit node is now REMOVED (Step 4), not left as a `remaining:0` husk the planner
    // would re-scan forever — the collector picked its last unit off the back and it vanished.
    expect(sim.world.has(node, Resource)).toBe(false);
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(3); // and exactly its 3 units stored
    expect(sim.world.has(cutter, Carrying)).toBe(false); // cutter is unloaded, nothing left to take
  });
});
