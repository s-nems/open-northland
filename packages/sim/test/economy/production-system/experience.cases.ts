import { describe, expect, it } from 'vitest';
import { Settler, Stockpile } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD } from './support.js';

const CARPENTER_GENERAL_TRACK = 3; // fixture jobExperience typeId for "carpenter general" (factor 100)

describe('productionSystem grants the operator profession XP per completed batch', () => {
  it('one completed cycle accrues the carpenter general track once', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the batch really finished
    const xp = sim.world.get(worker, Settler).experience;
    expect(xp.get(CARPENTER_GENERAL_TRACK)).toBe(100); // one batch = one experienceFactor grant
    expect(xp.size).toBe(1); // profession-level: the good-specific carpenter_plank track untouched
  });

  it('accumulates across cycles (two planks = two grants)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 2]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    for (let t = 0; t < CYCLE_TICKS * 2 + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).experience.get(CARPENTER_GENERAL_TRACK)).toBe(200);
  });
});
