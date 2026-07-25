import type { JobRequirement } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { experienceRequirementMet, settlerMeetsNeed } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from './support.js';

describe('experienceRequirementMet — a single needfor XP threshold', () => {
  // Track 1 (woodcutter wood) accrues at factor 10, so the amount-30 threshold needs 300 raw XP:
  // `amount` counts REPEATS (completed works), not raw XP.
  const WOOD_TRACK = 1;
  const WOOD_FACTOR = 10;
  const need: JobRequirement = {
    requirement: 'need',
    target: 'good',
    targetId: 2,
    amount: 30,
    experienceTypes: [WOOD_TRACK],
  };
  const ctx = ctxOf(new Simulation({ seed: 1, content: testContent() }));

  it('is unmet below the threshold and met at/above it (repeats = raw XP / factor)', () => {
    expect(experienceRequirementMet(ctx, new Map([[WOOD_TRACK, 29 * WOOD_FACTOR]]), need)).toBe(false);
    expect(experienceRequirementMet(ctx, new Map([[WOOD_TRACK, 30 * WOOD_FACTOR]]), need)).toBe(true); // exact
    expect(experienceRequirementMet(ctx, new Map([[WOOD_TRACK, 50 * WOOD_FACTOR]]), need)).toBe(true);
  });

  it('does not clear a repeats threshold with raw XP alone (the pre-repeats reading)', () => {
    // 30 raw XP is only 3 completed works on a factor-10 track — far short of 30 repeats.
    expect(experienceRequirementMet(ctx, new Map([[WOOD_TRACK, 30]]), need)).toBe(false);
  });

  it('treats a missing track as zero accrued XP', () => {
    expect(experienceRequirementMet(ctx, new Map(), need)).toBe(false);
  });

  it('sums REPEATS across all named experience types, each at its own factor', () => {
    // Track 1 accrues at factor 10, track 2 at factor 1 — the same raw XP is worth 10× fewer
    // repeats on track 1, so the sum must divide per track, not add raw XP.
    const twoTracks: JobRequirement = { ...need, experienceTypes: [1, 2] };
    expect(experienceRequirementMet(ctx, new Map([[1, 200]]), twoTracks)).toBe(false); // 20 < 30
    expect(
      experienceRequirementMet(
        ctx,
        new Map([
          [1, 200], // 20 repeats
          [2, 10], // 10 repeats
        ]),
        twoTracks,
      ),
    ).toBe(true); // 20 + 10 >= 30
  });

  it('counts raw XP as repeats for an expType with no track record (rate-1 buckets)', () => {
    // The fight/TRAINING/scout ids back no HumanJobExperienceType — they accrue at rate 1, so raw
    // XP already is the repeat count.
    const TRACKLESS = 77;
    const bucket: JobRequirement = { ...need, amount: 5, experienceTypes: [TRACKLESS] };
    expect(experienceRequirementMet(ctx, new Map([[TRACKLESS, 4]]), bucket)).toBe(false);
    expect(experienceRequirementMet(ctx, new Map([[TRACKLESS, 5]]), bucket)).toBe(true);
  });

  it('skips a train requirement (a schooling cost, not an accrued-XP threshold)', () => {
    const train: JobRequirement = { ...need, requirement: 'train', amount: 999 };
    expect(experienceRequirementMet(ctx, new Map(), train)).toBe(true); // vacuously met
  });

  it('is vacuously met when the requirement names no experience type', () => {
    expect(experienceRequirementMet(ctx, new Map(), { ...need, experienceTypes: [] })).toBe(true);
  });
});

describe('settlerMeetsNeed — all needfor thresholds gating a target', () => {
  // The fixture gates PLANK behind 30 repeats of track 1 (factor 10) — 300 raw XP.
  const WOOD_TRACK = 1;
  const PLANK = 2;

  it('gates a good below its accrued-XP threshold and clears it at/above', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    expect(settlerMeetsNeed(ctx, 1, 'good', PLANK, new Map([[WOOD_TRACK, 299]]))).toBe(false);
    expect(settlerMeetsNeed(ctx, 1, 'good', PLANK, new Map([[WOOD_TRACK, 300]]))).toBe(true);
  });

  it('ignores the train requirement on the same target (only need thresholds apply)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The fixture also carries a `train` requirement on PLANK with amount 999 — if it were treated as
    // an accrued-XP threshold, 300 XP could never clear it. settlerMeetsNeed must skip it.
    expect(settlerMeetsNeed(ctxOf(sim), 1, 'good', PLANK, new Map([[WOOD_TRACK, 300]]))).toBe(true);
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
