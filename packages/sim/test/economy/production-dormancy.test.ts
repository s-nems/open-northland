import { describe, expect, it, vi } from 'vitest';
import { Stockpile } from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { productionSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import {
  CYCLE_TICKS,
  ctxOf,
  PLANK,
  sawmill,
  spawnSettler,
  WOOD,
  WOODCUTTER,
} from './production-system/support.js';

// Counts every NodeBuckets construction, so the tests below can prove productionSystem builds its
// operator index only when a workplace actually looks up operators — never on a workshop-less or
// fully starved tick. (vi.hoisted, because the hoisted vi.mock factory below closes over it.)
const constructed = vi.hoisted(() => vi.fn());
vi.mock('../../src/systems/spatial.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/systems/spatial.js')>();
  class CountingBuckets extends actual.NodeBuckets {
    constructor(...args: ConstructorParameters<typeof actual.NodeBuckets>) {
      super(...args);
      constructed();
    }
  }
  return { ...actual, NodeBuckets: CountingBuckets };
});

describe('productionSystem operator-index dormancy', () => {
  it('builds no settler index on a tick with no producing workplace', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    spawnSettler(sim, WOODCUTTER, 3, 3); // settlers alone must not trigger the index
    constructed.mockClear();
    productionSystem(sim.world, ctxOf(sim));
    expect(constructed).not.toHaveBeenCalled();
  });

  it('builds no settler index while every workshop is starved of inputs', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    sawmill(sim, [[WOOD, 0]]); // no input — anyCycleStartable gates before the operator lookup
    constructed.mockClear();
    productionSystem(sim.world, ctxOf(sim));
    expect(constructed).not.toHaveBeenCalled();
  });

  it('builds the index once per tick and still produces when a cycle can start', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 2]]);
    constructed.mockClear();
    productionSystem(sim.world, ctxOf(sim));
    expect(constructed).toHaveBeenCalledTimes(1); // one shared index, both loops reuse it
    for (let t = 0; t < CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the deferral changed nothing
  });
});
