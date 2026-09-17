import { describe, expect, it } from 'vitest';
import { Position, Stockpile } from '../src/components/index.js';
import { positionOfNode } from '../src/nav/halfcell.js';
import { Simulation } from '../src/simulation.js';
import { createGroundGoods } from '../src/systems/economy/ground-goods.js';
import { MAX_GROUND_STACK } from '../src/systems/stores/index.js';
import { aiContent } from './fixtures/ai-content.js';

/** A laid heap is an ordinary yard heap at its lattice node, holding one to a full stack of the good. */
describe('createGroundGoods', () => {
  it('lays a heap at the node and clamps the unit count to the ground stack', () => {
    const sim = new Simulation({ seed: 1, content: aiContent() });
    const heap = createGroundGoods(sim.world, { goodType: 6, amount: 3, x: 5, y: 4 });
    expect(sim.world.get(heap, Position)).toEqual(positionOfNode(5, 4));
    expect([...sim.world.get(heap, Stockpile).amounts]).toEqual([[6, 3]]);
    const full = createGroundGoods(sim.world, { goodType: 6, amount: 99, x: 7, y: 4 });
    expect(sim.world.get(full, Stockpile).amounts.get(6)).toBe(MAX_GROUND_STACK);
    const single = createGroundGoods(sim.world, { goodType: 6, amount: 0, x: 9, y: 4 });
    expect(sim.world.get(single, Stockpile).amounts.get(6)).toBe(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
