import { describe, expect, it } from 'vitest';
import { ZERO } from '../../../src/core/fixed.js';
import { fx, ONE } from '../../../src/index.js';
import {
  EXPERIENCE_MASTERY_REPEATS,
  experienceBonus,
  experienceRepeats,
  SCOUT_EXPERIENCE_TYPE,
  SCOUT_VISION_BONUS_MAX_NODES,
  scoutVisionBonusNodes,
} from '../../../src/systems/index.js';

describe('experienceBonus — the repeats → bonus curve', () => {
  it('matches the reference table within 2 points at repeats 1..11', () => {
    // The user-specified reference bonus percentages the K = 4.9 fit targets.
    const reference = [17, 29, 38, 45, 51, 56, 60, 63, 66, 68, 70];
    for (const [i, expected] of reference.entries()) {
      const got = fx.toFloat(experienceBonus(i + 1)) * 100;
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(2);
    }
  });

  it('clamps to 0% below one repeat and to exactly 100% at mastery and beyond', () => {
    expect(experienceBonus(0)).toBe(ZERO);
    expect(experienceBonus(-3)).toBe(ZERO);
    expect(experienceBonus(EXPERIENCE_MASTERY_REPEATS)).toBe(ONE);
    expect(experienceBonus(EXPERIENCE_MASTERY_REPEATS + 500)).toBe(ONE);
  });

  it('is monotonically increasing from 0 to mastery', () => {
    for (let n = 1; n <= EXPERIENCE_MASTERY_REPEATS; n++) {
      expect(experienceBonus(n)).toBeGreaterThan(experienceBonus(n - 1));
    }
  });

  it('truncates fractional repeats (integer domain)', () => {
    expect(experienceBonus(5.9)).toBe(experienceBonus(5));
  });
});

describe('scoutVisionBonusNodes — signpost craft widens the scout eye a little', () => {
  const withPosts = (posts: number) => new Map([[SCOUT_EXPERIENCE_TYPE, posts]]);

  it('scales the curve to whole extra nodes, capped well below a 2x eye', () => {
    expect(scoutVisionBonusNodes(new Map())).toBe(0);
    expect(scoutVisionBonusNodes(withPosts(10))).toBe(4); // ~69% of the 6-node cap, truncated
    expect(scoutVisionBonusNodes(withPosts(100))).toBe(SCOUT_VISION_BONUS_MAX_NODES); // mastery: the full cap
  });
});

describe('experienceRepeats — raw XP back to completed-work repeats', () => {
  const track = { typeId: 1, id: 't', jobType: 1, experienceFactor: 100 };

  it('divides the accrual rate back out, truncating partial credit', () => {
    expect(experienceRepeats(0, track)).toBe(0);
    expect(experienceRepeats(500, track)).toBe(5);
    expect(experienceRepeats(599, track)).toBe(5);
  });

  it('a rate-0 track represents no repeats', () => {
    expect(experienceRepeats(500, { ...track, experienceFactor: 0 })).toBe(0);
  });
});
