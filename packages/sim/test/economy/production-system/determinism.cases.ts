import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, PLANK, sawmill, WOOD } from './support.js';

describe('productionSystem — determinism', () => {
  it('two same-seed runs reach the same state hash through the full schedule', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: testContent() });
      sawmill(sim, [
        [WOOD, 4],
        [PLANK, 0],
      ]);
      for (let t = 0; t < CYCLE_TICKS * 2 + 5; t++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
