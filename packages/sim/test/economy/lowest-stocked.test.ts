import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { ExternalFoodIndex } from '../../src/systems/family/food-search.js';
import { lowestStockedGood } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import {
  BREAD,
  buildingAt,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  HEADQUARTERS,
  WOOD,
} from './producer-supply/support.js';

/** Every insertion order of `lines`, so a pick that followed map order instead of the good id shows. */
function orders(lines: Array<[number, number]>): Array<Array<[number, number]>> {
  if (lines.length <= 1) return [lines];
  return lines.flatMap((line, i) => orders(lines.filter((_, j) => j !== i)).map((rest) => [line, ...rest]));
}

describe('stock min scans pick by good id, not insertion order', () => {
  it('lowestStockedGood skips empty lines and returns the lowest stocked id', () => {
    for (const lines of orders([
      [BREAD, 2],
      [WOOD, 0],
      [FOOD_SIMPLE, 1],
    ])) {
      expect(lowestStockedGood({ amounts: new Map(lines) })).toBe(FOOD_SIMPLE);
    }
    expect(lowestStockedGood({ amounts: new Map([[WOOD, 0]]) })).toBeNull();
  });

  it('the family food search lifts the lowest-id edible, skipping non-food and empty lines', () => {
    for (const [foodSimple, expected] of [
      [1, FOOD_SIMPLE],
      [0, BREAD],
    ] as const) {
      for (const lines of orders([
        [BREAD, 3],
        [WOOD, 5],
        [FOOD_SIMPLE, foodSimple],
      ])) {
        const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
        const hq = buildingAt(sim, HEADQUARTERS, 0, 0, lines);
        const index = new ExternalFoodIndex(sim.world, ctxOf(sim), sim.terrain);
        expect(index.nearest({ hx: 0, hy: 0 }, undefined, null)).toEqual({ store: hq, goodType: expected });
      }
    }
  });
});
