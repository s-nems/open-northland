import { describe, expect, it } from 'vitest';
import { Building, Carrying, CurrentAtomic, Resource, Stockpile } from '../../../src/components/index.js';
import { ONE, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, PLANK, SAWMILL, startAtomic, WOOD } from './support.js';

describe('atomicSystem — end-to-end: harvest -> carry -> pileup', () => {
  it('a settler harvests wood then piles it up at a store via two atomics', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const settler = sim.world.create();
    const resource = sim.world.create();
    // A plain single-hit wood node (no Felling): one swing yields one unit onto the back.
    sim.world.add(resource, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    // Atomic 1: harvest wood (2-tick animation).
    startAtomic(sim, settler, { kind: 'harvest', resource, goodType: WOOD }, 2, 24);
    atomicSystem(sim.world, ctxOf(sim)); // tick 1: progress 1/2
    expect(sim.world.has(settler, Carrying)).toBe(false);
    atomicSystem(sim.world, ctxOf(sim)); // tick 2: completes, +1 wood
    expect(sim.world.get(settler, Carrying)).toEqual({ goodType: WOOD, amount: 1 });

    // Atomic 2: pileup at the store.
    startAtomic(sim, settler, { kind: 'pileup', store }, 1, 23);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(store, Stockpile).amounts.get(WOOD)).toBe(1);
    expect(sim.world.has(settler, Carrying)).toBe(false);
  });
});

describe('atomicSystem — determinism', () => {
  it('two same-seed runs reach the same state hash', () => {
    const run = (): string => {
      CurrentAtomic.store.clear();
      Carrying.store.clear();
      Stockpile.store.clear();
      Building.store.clear();
      const sim = new Simulation({ seed: 5, content: testContent() });
      const settler = sim.world.create();
      const store = sim.world.create();
      sim.world.add(store, Building, { buildingType: SAWMILL, tribe: 1, built: ONE, level: 0 });
      sim.world.add(store, Stockpile, { amounts: new Map() });
      startAtomic(sim, settler, { kind: 'pickup', goodType: PLANK, amount: 4, from: null }, 3, 22);
      for (let i = 0; i < 3; i++) sim.step();
      startAtomic(sim, settler, { kind: 'pileup', store }, 2, 23);
      for (let i = 0; i < 2; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
