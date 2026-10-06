import { describe, expect, it } from 'vitest';
import type { NodeId, TerrainMap } from '../../../src/nav/terrain/index.js';
import { Simulation } from '../../../src/simulation.js';
import { SeedWalks, WalkFlood } from '../../../src/systems/ai-player/walk-distance.js';
import { flagGround } from '../../../src/systems/ai-player/workforce/flag-spots.js';
import { walkBlockMask } from '../../../src/systems/footprint/walk-block-mask.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from './support.js';

const GRASS = 0;
const WATER = 1;
const SIZE = 160;
/** A water wall down the middle, open only past `GAP_FROM`, so a walk across it detours far. */
const WALL_X = 80;
const GAP_FROM = 150;
const ORIGIN = { hx: 70, hy: 20 };
const REACH = 4;
/** The budgets the two kinds of carriers' walk keep (`workforce/flag-spots.ts`). */
const AIMED_BUDGET = 4096;
const FLOOD_BUDGET = 16384;
const TARGET_X = 90;
const TARGET_STEP = 10;

function walledMap(): TerrainMap {
  const typeIds = new Array<number>(SIZE * SIZE).fill(GRASS);
  for (let hy = 0; hy < GAP_FROM; hy++) typeIds[hy * SIZE + WALL_X] = WATER;
  return { resolution: 'half-cell', width: SIZE, height: SIZE, typeIds };
}

describe('carriers walk budgets', () => {
  it('caps a seat aimed walk at 4096 settles and the flag follow flood at 16384', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: walledMap() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const ctx = ctxOf(sim);
    const mask = walkBlockMask(sim.world, ctx, terrain);
    const seed = terrain.nodeAt(ORIGIN.hx, ORIGIN.hy);
    let budgetsDiffer = 0;
    for (let hy = 0; hy < GAP_FROM; hy += TARGET_STEP) {
      const toward = { hx: TARGET_X, hy };
      const node: NodeId = terrain.nodeAt(toward.hx, toward.hy);
      const aimedAt = (budget: number) =>
        new SeedWalks(terrain, mask, seed, budget, 'aimed').toward(toward, REACH).costTo(node);
      const aimed = flagGround(sim.world, ctx, terrain, null, 'aimed').walkFrom(ORIGIN, toward, REACH);
      expect(aimed.costTo(node)).toBe(aimedAt(AIMED_BUDGET));
      const flood = flagGround(sim.world, ctx, terrain, null, 'flood').walkFrom(ORIGIN, toward, REACH);
      expect(flood.costTo(node)).toBe(new WalkFlood(terrain, mask, [seed], FLOOD_BUDGET).costTo(node));
      if (aimedAt(AIMED_BUDGET) !== aimedAt(FLOOD_BUDGET)) budgetsDiffer++;
    }
    // Some target lies past the aimed cap yet within the flood's: the two budgets are told apart.
    expect(budgetsDiffer).toBeGreaterThan(0);
  });
});
