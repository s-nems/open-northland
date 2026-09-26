import { describe, expect, it } from 'vitest';
import { fx } from '../../../src/core/fixed.js';
import { Simulation } from '../../../src/index.js';
import { CountedBlocks } from '../../../src/nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { WalkFlood } from '../../../src/systems/ai-player/walk-distance.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { waterColumnMap } from '../../fixtures/terrain.js';

// The lazy walk flood behind the flag spot search: the same costs whatever is asked first, and a budget
// that cuts the far side off.

const MAP_CELLS_WIDE = 24;
const MAP_CELLS_HIGH = 12;
/** The cell column of water that splits the map into two banks. */
const WATER_COLUMN = 12;
const SEED = { hx: 4, hy: 4 };
/** Nodes on the seed's bank, near and far, and one across the water. */
const WEST_NEAR = { hx: 6, hy: 6 };
const WEST_FAR = { hx: 20, hy: 18 };
const EAST = { hx: 40, hy: 10 };
/** A flood budget past the bank's node count, so only the water stops it. */
const WHOLE_BANK = 100_000;
/** A budget that settles a few nodes round the seed and no more. */
const SMALL_BUDGET = 12;

function bank(): TerrainGraph {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: waterColumnMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH, WATER_COLUMN),
  });
  if (sim.terrain === undefined) throw new Error('setup: no terrain');
  return sim.terrain;
}

const NO_BLOCKS = new CountedBlocks([]);

function flood(terrain: TerrainGraph, seed: { hx: number; hy: number }, budget = WHOLE_BANK): WalkFlood {
  return new WalkFlood(terrain, NO_BLOCKS, [terrain.nodeAt(seed.hx, seed.hy)], budget);
}

describe('ai-player walk flood', () => {
  it('costs a node the same whether it is asked first, last or alone', () => {
    const terrain = bank();
    const nodes: NodeId[] = [];
    for (let hy = 0; hy < 2 * MAP_CELLS_HIGH; hy += 3) {
      for (let hx = 0; hx < 2 * MAP_CELLS_WIDE; hx += 5) nodes.push(terrain.nodeAt(hx, hy));
    }
    const forward = flood(terrain, SEED);
    const forwardCosts = nodes.map((node) => forward.costTo(node));
    const backward = flood(terrain, SEED);
    const backwardCosts = [...nodes]
      .reverse()
      .map((node) => backward.costTo(node))
      .reverse();
    const aloneCosts = nodes.map((node) => flood(terrain, SEED).costTo(node));
    expect(backwardCosts).toEqual(forwardCosts);
    expect(aloneCosts).toEqual(forwardCosts);
    expect(forwardCosts.some((cost) => cost !== undefined)).toBe(true);
  });

  it('reaches the seed bank and never the far one', () => {
    const terrain = bank();
    const walk = flood(terrain, SEED);
    expect(walk.costTo(terrain.nodeAt(SEED.hx, SEED.hy))).toBe(fx.fromInt(0));
    const near = walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy));
    const far = walk.costTo(terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy));
    if (near === undefined || far === undefined) throw new Error('the seed bank is walkable');
    expect(near).toBeLessThan(far);
    expect(walk.costTo(terrain.nodeAt(EAST.hx, EAST.hy))).toBeUndefined();
  });

  it('reads a node past the budget as unreached, the settled ones as before', () => {
    const terrain = bank();
    const walk = flood(terrain, SEED, SMALL_BUDGET);
    const near = walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy));
    expect(walk.costTo(terrain.nodeAt(WEST_FAR.hx, WEST_FAR.hy))).toBeUndefined();
    expect(walk.costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy))).toBe(near);
    expect(
      near === undefined || near === flood(terrain, SEED).costTo(terrain.nodeAt(WEST_NEAR.hx, WEST_NEAR.hy)),
    ).toBe(true);
  });
});
