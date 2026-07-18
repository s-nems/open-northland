import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '../../src/index.js';
import { collectTargets } from '../../src/systems/agents/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

// Counts every InteractionCellIndex construction, so the tests below can prove collectTargets
// defers the three index builds to their first accessor instead of paying them eagerly per tick.
// (vi.hoisted, because the hoisted vi.mock factory below closes over it.)
const constructed = vi.hoisted(() => vi.fn());
vi.mock('../../src/systems/agents/targets/cell-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/systems/agents/targets/cell-index.js')>();
  class CountingIndex extends actual.InteractionCellIndex {
    constructor(...args: ConstructorParameters<typeof actual.InteractionCellIndex>) {
      super(...args);
      constructed();
    }
  }
  return { ...actual, InteractionCellIndex: CountingIndex };
});

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  return { sim, terrain, targets: collectTargets(sim.world, ctxOf(sim), terrain) };
}

describe('collectTargets cell indexes', () => {
  it('constructs no index until one is accessed', () => {
    constructed.mockClear();
    const { terrain, targets } = fixture();
    expect(constructed).not.toHaveBeenCalled();
    targets.stockpileCells.nearest(terrain.nodeAt(0, 0), () => null);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('memoizes each index for the tick — one build per accessed category', () => {
    constructed.mockClear();
    const { targets } = fixture();
    expect(targets.stockpileCells).toBe(targets.stockpileCells);
    expect(targets.buildingCells).toBe(targets.buildingCells);
    expect(targets.constructionSiteCells).toBe(targets.constructionSiteCells);
    expect(constructed).toHaveBeenCalledTimes(3);
  });
});
