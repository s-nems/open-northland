import { describe, expect, it } from 'vitest';
import { topCoveredTier } from '../../../src/systems/computer-player/top-tier.js';

const WOOD = 1;
const ORNAMENT = 2;
const BILLS: Readonly<Record<string, readonly { goodType: number; amount: number }[]>> = {
  plain: [{ goodType: WOOD, amount: 2 }],
  fine: [
    { goodType: WOOD, amount: 2 },
    { goodType: ORNAMENT, amount: 2 },
  ],
};
const TIERS = ['plain', 'fine'];

describe('the top covered tier', () => {
  it('is the highest tier whose whole bill is held', () => {
    const held = (good: number): number => (good === WOOD ? 2 : 0);
    expect(topCoveredTier(TIERS, (tier) => BILLS[tier], held)).toBe('plain');
    expect(
      topCoveredTier(
        TIERS,
        (tier) => BILLS[tier],
        () => 2,
      ),
    ).toBe('fine');
  });

  it('is none while not even the lowest bill is held, or a tier has no bill', () => {
    expect(
      topCoveredTier(
        TIERS,
        (tier) => BILLS[tier],
        () => 1,
      ),
    ).toBeUndefined();
    expect(
      topCoveredTier(
        TIERS,
        () => undefined,
        () => 2,
      ),
    ).toBeUndefined();
  });
});
