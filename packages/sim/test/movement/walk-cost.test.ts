import { describe, expect, it } from 'vitest';
import {
  MAX_STEP_TICKS,
  MIN_STEP_TICKS,
  UNMODIFIED_STEP,
  walkStepTicks,
} from '../../src/systems/movement/walk-cost.js';

// The original's per-step cost for an ordinary adult
// civilian: a full E/W cell is two steps, so the cell figures are twice the step ones.

const SHOD = { ...UNMODIFIED_STEP, shoes: true };
const TIRED = { ...UNMODIFIED_STEP, tired: true };
const TIRED_SHOD = { ...TIRED, shoes: true };

describe('walkStepTicks', () => {
  it('applies tribe reduction, age, combined gear rounding and script flags in engine order', () => {
    const m = { ...UNMODIFIED_STEP, tribeReduction: 2, equipmentWeight: 5 };
    expect(walkStepTicks(2, { ...m, age: 'baby' })).toBe(14); // (8-2)*2 + floor(5/2)
    expect(walkStepTicks(2, { ...m, age: 'child' })).toBe(10);
    expect(walkStepTicks(2, { ...m, age: 'adult' })).toBe(8);
    expect(walkStepTicks(2, { ...m, age: 'baby', walksSlowly: true, walksFast: true })).toBe(26);
    expect(walkStepTicks(0, { ...m, shoes: true, walksFast: true })).toBe(3);
  });
  it('costs 2·roughness + 4 barefoot and 2·roughness + 2 shod for a rested walker, floored at 3', () => {
    // roughness: road/water 1, land 2, sand/beach/desert stone 3, mountain 4, snow 5 (and 0 on the maps).
    expect([0, 1, 2, 3, 4, 5].map((r) => walkStepTicks(r, UNMODIFIED_STEP))).toEqual([4, 6, 8, 10, 12, 14]);
    expect([0, 1, 2, 3, 4, 5].map((r) => walkStepTicks(r, SHOD))).toEqual([3, 4, 6, 8, 10, 12]);
  });

  it('adds two ticks a step once the walker is due for sleep: the 2·roughness + 6 / + 4 figures', () => {
    // Per E/W cell (two steps): road 16/12, land 20/16, sand 24/20, mountain 28/24, snow 32/28.
    expect([1, 2, 3, 4, 5].map((r) => 2 * walkStepTicks(r, TIRED))).toEqual([16, 20, 24, 28, 32]);
    expect([1, 2, 3, 4, 5].map((r) => 2 * walkStepTicks(r, TIRED_SHOD))).toEqual([12, 16, 20, 24, 28]);
  });

  it('adds one tick a step while hauling a good', () => {
    expect(walkStepTicks(2, { ...UNMODIFIED_STEP, carrying: true })).toBe(9);
    expect(walkStepTicks(2, { ...TIRED_SHOD, carrying: true })).toBe(9);
  });

  it('applies the script bits after the state terms: slow doubles, fast takes two off, then the floor', () => {
    expect(walkStepTicks(2, { ...UNMODIFIED_STEP, walksSlowly: true })).toBe(16);
    expect(walkStepTicks(2, { ...UNMODIFIED_STEP, walksFast: true })).toBe(6);
    expect(walkStepTicks(2, { ...UNMODIFIED_STEP, walksSlowly: true, walksFast: true })).toBe(14);
    expect(walkStepTicks(0, { ...SHOD, walksFast: true })).toBe(MIN_STEP_TICKS);
  });

  it('bounds the longest ordinary step, which paces the obstruction floor', () => {
    expect(MAX_STEP_TICKS).toBe(34); // (10 + 2 + 2 + 1 + 2) doubled
  });
});
