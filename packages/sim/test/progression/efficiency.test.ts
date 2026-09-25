import { describe, expect, it } from 'vitest';
import { buildStepsPerSwing, strokesPerUnit } from '../../src/systems/progression/efficiency.js';

// The original's job efficiency arithmetic: tool work factors 100 (bare), 125 (wooden), 175 (iron).
const BARE = 100;
const WOODEN = 125;
const IRON = 175;

describe('strokesPerUnit - the strokes one unit costs', () => {
  it('a bare-handed novice pays the trade count; every twenty percent saves one stroke', () => {
    expect(strokesPerUnit(10, 0, BARE)).toBe(10);
    expect(strokesPerUnit(10, 19, BARE)).toBe(10);
    expect(strokesPerUnit(10, 20, BARE)).toBe(9);
    expect(strokesPerUnit(10, 51, BARE)).toBe(8);
    expect(strokesPerUnit(10, 100, BARE)).toBe(5);
  });

  it('a tool divides the count before the experience discount, truncating', () => {
    expect(strokesPerUnit(10, 0, WOODEN)).toBe(8); // 1000 / 125
    expect(strokesPerUnit(10, 0, IRON)).toBe(5); // 1000 / 175 = 5.7
    expect(strokesPerUnit(5, 0, WOODEN)).toBe(4); // the fisher's casts
    expect(strokesPerUnit(5, 0, IRON)).toBe(2);
  });

  it('never drops below one stroke: a master with an iron tool clears a unit per swing', () => {
    expect(strokesPerUnit(10, 100, IRON)).toBe(1);
    expect(strokesPerUnit(2, 100, BARE)).toBe(1);
    expect(strokesPerUnit(1, 0, BARE)).toBe(1);
  });
});

describe('buildStepsPerSwing - the construction steps one hammer swing installs', () => {
  it('one step bare-handed until fifty percent, then two', () => {
    expect(buildStepsPerSwing(0, BARE)).toBe(1);
    expect(buildStepsPerSwing(49, BARE)).toBe(1);
    expect(buildStepsPerSwing(50, BARE)).toBe(2);
    expect(buildStepsPerSwing(100, BARE)).toBe(2);
  });

  it('a wooden tool reaches two steps at ten percent and three at ninety', () => {
    expect(buildStepsPerSwing(0, WOODEN)).toBe(1);
    expect(buildStepsPerSwing(10, WOODEN)).toBe(2);
    expect(buildStepsPerSwing(89, WOODEN)).toBe(2);
    expect(buildStepsPerSwing(90, WOODEN)).toBe(3);
  });

  it('an iron tool starts at two steps and tops out at four', () => {
    expect(buildStepsPerSwing(0, IRON)).toBe(2);
    expect(buildStepsPerSwing(22, IRON)).toBe(3);
    expect(buildStepsPerSwing(78, IRON)).toBe(3);
    expect(buildStepsPerSwing(79, IRON)).toBe(4);
    expect(buildStepsPerSwing(100, IRON)).toBe(4);
  });
});
