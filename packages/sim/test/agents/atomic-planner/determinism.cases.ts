import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassMap, storeAt, woodAt, woodcutterAt } from './support.js';

describe('atomicPlanner — determinism', () => {
  it('two same-seed runs of the full chain reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 11, content: testContent(), map: grassMap(4, 1) });
      woodcutterAt(sim, 0, 0);
      woodAt(sim, 1, 0, 5);
      storeAt(sim, 2, 0);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
