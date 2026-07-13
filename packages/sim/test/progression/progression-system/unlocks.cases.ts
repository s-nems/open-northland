import type { JobRequirement } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { experienceRequirementMet, settlerMeetsNeed } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from './support.js';

describe('experienceRequirementMet — a single needfor XP threshold', () => {
  const WOOD_TRACK = 1;
  const need: JobRequirement = {
    requirement: 'need',
    target: 'good',
    targetId: 2,
    amount: 30,
    experienceTypes: [WOOD_TRACK],
  };

  it('is unmet below the threshold and met at/above it', () => {
    expect(experienceRequirementMet(new Map([[WOOD_TRACK, 20]]), need)).toBe(false);
    expect(experienceRequirementMet(new Map([[WOOD_TRACK, 30]]), need)).toBe(true); // exact
    expect(experienceRequirementMet(new Map([[WOOD_TRACK, 50]]), need)).toBe(true);
  });

  it('treats a missing track as zero accrued XP', () => {
    expect(experienceRequirementMet(new Map(), need)).toBe(false);
  });

  it('sums XP across all named experience types', () => {
    const twoTracks: JobRequirement = { ...need, experienceTypes: [1, 2] };
    expect(experienceRequirementMet(new Map([[1, 20]]), twoTracks)).toBe(false); // 20 < 30
    expect(
      experienceRequirementMet(
        new Map([
          [1, 20],
          [2, 15],
        ]),
        twoTracks,
      ),
    ).toBe(true); // 35 >= 30
  });

  it('skips a train requirement (a schooling cost, not an accrued-XP threshold)', () => {
    const train: JobRequirement = { ...need, requirement: 'train', amount: 999 };
    expect(experienceRequirementMet(new Map(), train)).toBe(true); // vacuously met
  });

  it('is vacuously met when the requirement names no experience type', () => {
    expect(experienceRequirementMet(new Map(), { ...need, experienceTypes: [] })).toBe(true);
  });
});

describe('settlerMeetsNeed — all needfor thresholds gating a target', () => {
  const WOOD_TRACK = 1;
  const PLANK = 2;

  it('gates a good below its accrued-XP threshold and clears it at/above', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    expect(settlerMeetsNeed(ctx, 1, 'good', PLANK, new Map([[WOOD_TRACK, 29]]))).toBe(false);
    expect(settlerMeetsNeed(ctx, 1, 'good', PLANK, new Map([[WOOD_TRACK, 30]]))).toBe(true);
  });

  it('ignores the train requirement on the same target (only need thresholds apply)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The fixture also carries a `train` requirement on PLANK with amount 999 — if it were treated as
    // an accrued-XP threshold, 30 XP could never clear it. settlerMeetsNeed must skip it.
    expect(settlerMeetsNeed(ctxOf(sim), 1, 'good', PLANK, new Map([[WOOD_TRACK, 30]]))).toBe(true);
  });

  it('is met for a target with no need requirement at all', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Good 1 (wood) carries no `needfor` requirement in the fixture → any settler clears it.
    expect(settlerMeetsNeed(ctxOf(sim), 1, 'good', 1, new Map())).toBe(true);
  });

  it('thresholds nothing for a tribe absent from content', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(settlerMeetsNeed(ctxOf(sim), 999, 'good', PLANK, new Map())).toBe(true);
  });
});
