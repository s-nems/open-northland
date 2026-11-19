import { describe, expect, it } from 'vitest';
import { MAX_STORAGE_CAPACITY_FACTOR, Stockpile } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { stockCapacity } from '../../../src/systems/stores/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  buildingAt,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  SAWMILL,
  WOOD,
} from '../economy/production/producer-supply/support.js';

const HEADQUARTERS_WOOD_SLOT = 150;
const SAWMILL_WOOD_SLOT = 20;
const FACTOR = 3;

describe('the storage capacity rule', () => {
  it('multiplies the storage buildings and leaves every other shelf as declared', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 2, 0);
    const sawmill = buildingAt(sim, SAWMILL, 6, 0);
    sim.enqueueSetup({ kind: 'setStorageCapacity', factor: FACTOR });
    // Past the cap: skipped, the factor before it stands.
    sim.enqueueSetup({ kind: 'setStorageCapacity', factor: MAX_STORAGE_CAPACITY_FACTOR + 1 });
    sim.enqueueSetup({ kind: 'debugFillStockpile', target: hq, goodType: WOOD });
    sim.step();
    const ctx = ctxOf(sim);
    expect(stockCapacity(sim.world, ctx, hq, WOOD)).toBe(FACTOR * HEADQUARTERS_WOOD_SLOT);
    expect(stockCapacity(sim.world, ctx, sawmill, WOOD)).toBe(SAWMILL_WOOD_SLOT);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(FACTOR * HEADQUARTERS_WOOD_SLOT);
  });
});
