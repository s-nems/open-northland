import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../../src/index.js';
import * as cells from '../../src/systems/settlers/targets/cell-index.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

// Counts every InteractionCellIndex construction, so the tests below can prove collectTargets defers
// the per-tick index builds to their first accessor and keeps the stockpile index across ticks.
// A construct trap keeps the real prototype, and spying the live export rather than mocking the
// module reaches a subject an earlier file in this worker already imported.
const constructed = vi.fn();
const CountingIndex = new Proxy(cells.InteractionCellIndex, {
  construct(target, args) {
    constructed();
    return Reflect.construct(target, args);
  },
});

beforeEach(() => {
  vi.spyOn(cells, 'InteractionCellIndex').mockImplementation(CountingIndex);
});
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  return { sim, terrain, targets: collectTargets(sim.world, ctxOf(sim), terrain) };
}

describe('collectTargets cell indexes', () => {
  it('constructs no per-tick index until one is accessed', () => {
    const { terrain, targets } = fixture();
    constructed.mockClear();
    targets.stockpileCells.nearest(terrain.nodeAt(0, 0), () => null);
    expect(constructed).not.toHaveBeenCalled();
    targets.constructionSiteCells.nearest(terrain.nodeAt(0, 0), () => null);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('memoizes each per-tick index for the tick - one build per accessed category', () => {
    const { targets } = fixture();
    constructed.mockClear();
    expect(targets.constructionSiteCells).toBe(targets.constructionSiteCells);
    expect(targets.wallSiteCells).toBe(targets.wallSiteCells);
    expect(constructed).toHaveBeenCalledTimes(2);
  });

  it('keeps the stockpile index across ticks instead of rebuilding it', () => {
    const { sim, terrain, targets } = fixture();
    constructed.mockClear();
    const next = collectTargets(sim.world, ctxOf(sim), terrain);
    expect(next.stockpileCells).toBe(targets.stockpileCells);
    expect(constructed).not.toHaveBeenCalled();
  });
});
