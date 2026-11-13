import type { JobRequirement } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  computerModuleEnables,
  setProfessionProgression,
} from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import {
  experienceRequirementMet,
  goodEnabled,
  type NeedSubject,
  settlerMeetsNeed,
} from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from './support.js';

const HUMAN_PLAYER = 0;
const AI_PLAYER = 1;
/** The fixture's `soldier_unarmed` - a job the content classifies as a fighter. */
const SOLDIER_JOB = 31;

/** Flag `player`'s seat AI-driven, the state the `setAiControl` command lands (no tick needed). */
function makeAiSeat(sim: Simulation, player: number): void {
  sim.world.add(sim.world.create(), AiControl, {
    player,
    computerEnabled: true,
    modules: computerModuleEnables(),
    mapAiEnabled: true,
    difficulty: 'hard',
  });
}

describe('experienceRequirementMet - a single needfor XP threshold', () => {
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
    // 30 raw XP is only 3 completed works on a factor-10 track - far short of 30 repeats.
    expect(experienceRequirementMet(ctx, new Map([[WOOD_TRACK, 30]]), need)).toBe(false);
  });

  it('treats a missing track as zero accrued XP', () => {
    expect(experienceRequirementMet(ctx, new Map(), need)).toBe(false);
  });

  it('sums REPEATS across all named experience types, each at its own factor', () => {
    // Track 1 (woodcutter wood) accrues at factor 10, track 4 (carpenter plank) at factor 7 - the
    // same raw XP is worth different repeats per track, so the sum must divide per track, not add
    // raw XP. Both are good-SPECIFIC tracks (a general one would widen to its whole job, below).
    const twoTracks: JobRequirement = { ...need, experienceTypes: [1, 4] };
    expect(experienceRequirementMet(ctx, new Map([[1, 200]]), twoTracks)).toBe(false); // 20 < 30
    expect(
      experienceRequirementMet(
        ctx,
        new Map([
          [1, 200], // 20 repeats
          [4, 70], // 10 repeats
        ]),
        twoTracks,
      ),
    ).toBe(true); // 20 + 10 >= 30
  });

  it('a general requirement reads its own counter without adding specializations', () => {
    const generalKeyed: JobRequirement = { ...need, experienceTypes: [2] };
    expect(experienceRequirementMet(ctx, new Map([[1, 300]]), generalKeyed)).toBe(false);
    expect(experienceRequirementMet(ctx, new Map([[2, 29]]), generalKeyed)).toBe(false);
    expect(experienceRequirementMet(ctx, new Map([[2, 30]]), generalKeyed)).toBe(true);
  });

  it('counts each track once when a row names a general track beside its own specific', () => {
    // Track 2 is woodcutter-GENERAL, track 1 its wood specific - the general's whole-job widening
    // must not credit the wood repeats a second time for being named directly.
    const both: JobRequirement = { ...need, experienceTypes: [2, 1] };
    expect(experienceRequirementMet(ctx, new Map([[1, 290]]), both)).toBe(false); // 29, not 58
    expect(experienceRequirementMet(ctx, new Map([[1, 300]]), both)).toBe(true); // exactly 30
  });

  it('counts raw XP as repeats for an expType with no track record (rate-1 buckets)', () => {
    // The fight/TRAINING/scout ids back no HumanJobExperienceType - they accrue at rate 1, so raw
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

describe('settlerMeetsNeed - all needfor thresholds gating a target', () => {
  // The fixture gates PLANK behind 30 repeats of track 1 (factor 10) - 300 raw XP.
  const WOOD_TRACK = 1;
  const PLANK = 2;
  const VIKING = 1;

  /** A human-owned subject of {@link VIKING} carrying `xp` raw points on the wood track. */
  const human = (xp?: number): NeedSubject => ({
    tribe: VIKING,
    owner: HUMAN_PLAYER,
    jobType: null,
    experience: xp === undefined ? new Map() : new Map([[WOOD_TRACK, xp]]),
    learned: undefined,
  });

  it('gates a good below its accrued-XP threshold and clears it at/above', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    expect(settlerMeetsNeed(sim.world, ctx, human(299), 'good', PLANK)).toBe(false);
    expect(settlerMeetsNeed(sim.world, ctx, human(300), 'good', PLANK)).toBe(true);
  });

  it('ignores the train requirement on the same target (only need thresholds apply)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // The fixture also carries a `train` requirement on PLANK with amount 999 - if it were treated as
    // an accrued-XP threshold, 300 XP could never clear it. settlerMeetsNeed must skip it.
    expect(settlerMeetsNeed(sim.world, ctxOf(sim), human(300), 'good', PLANK)).toBe(true);
  });

  it('is met for a target with no need requirement at all', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Good 1 (wood) carries no `needfor` requirement in the fixture → any settler clears it.
    expect(settlerMeetsNeed(sim.world, ctxOf(sim), human(), 'good', 1)).toBe(true);
  });

  it('thresholds nothing for a tribe absent from content', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const stranger: NeedSubject = { ...human(), tribe: 999 };
    expect(settlerMeetsNeed(sim.world, ctxOf(sim), stranger, 'good', PLANK)).toBe(true);
  });

  it('unthresholds civilian targets while profession progression is off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    setProfessionProgression(sim.world, false);
    expect(settlerMeetsNeed(sim.world, ctx, human(), 'good', PLANK)).toBe(true); // free start
    setProfessionProgression(sim.world, true); // re-enabling restores the civilian threshold
    expect(settlerMeetsNeed(sim.world, ctx, human(), 'good', PLANK)).toBe(false);
  });

  it('gates an AI seat like a human under the toggle, and opens both with it off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    makeAiSeat(sim, AI_PLAYER);
    const bot: NeedSubject = {
      tribe: VIKING,
      owner: AI_PLAYER,
      jobType: null,
      experience: new Map(),
      learned: undefined,
    };
    expect(settlerMeetsNeed(sim.world, ctx, bot, 'good', PLANK)).toBe(false);
    expect(goodEnabled(sim.world, ctx, AI_PLAYER, VIKING, PLANK)).toBe(false);
    setProfessionProgression(sim.world, false);
    expect(settlerMeetsNeed(sim.world, ctx, bot, 'good', PLANK)).toBe(true);
    expect(goodEnabled(sim.world, ctx, AI_PLAYER, VIKING, PLANK)).toBe(true);
  });
});

describe('settlerMeetsNeed - a fighter trade', () => {
  const VIKING = 1;
  const SWORD_SOLDIER_JOB = 34;
  const HERO_JOB = 45;
  /** The extracted rows' sword fight bucket, track-less. */
  const SWORD_BUCKET = 73;

  /** The fixture plus a second soldier class, gated by an unmet `needforjob` row. */
  function fighterSim(): Simulation {
    const content = testContent();
    const unarmed = content.jobs.find((job) => job.typeId === SOLDIER_JOB);
    if (unarmed === undefined) throw new Error('fixture lost its soldier trade');
    content.jobs.push({ ...unarmed, typeId: SWORD_SOLDIER_JOB, id: 'soldier_sword_short' });
    content.tribes[0]?.jobRequirements.push({
      requirement: 'need',
      target: 'job',
      targetId: SWORD_SOLDIER_JOB,
      amount: 10,
      experienceTypes: [SWORD_BUCKET],
    });
    return new Simulation({ seed: 1, content });
  }

  function subject(jobType: number | null, learnedJobs: readonly number[] = []): NeedSubject {
    return {
      tribe: VIKING,
      owner: HUMAN_PLAYER,
      jobType,
      experience: new Map(),
      learned: { job: learnedJobs, good: [] },
    };
  }

  it('is refused to a civilian, with progression on and off: the barracks makes soldiers', () => {
    const sim = fighterSim();
    const ctx = ctxOf(sim);
    const civilian = subject(null);
    for (const progression of [true, false]) {
      setProfessionProgression(sim.world, progression);
      expect(settlerMeetsNeed(sim.world, ctx, civilian, 'job', SOLDIER_JOB)).toBe(false);
      expect(settlerMeetsNeed(sim.world, ctx, civilian, 'job', HERO_JOB)).toBe(false);
    }
  });

  it('opens every class of its band, unthresholded, to one who holds or once held a trade of it', () => {
    const sim = fighterSim();
    const ctx = ctxOf(sim);
    const soldier = subject(SOLDIER_JOB);
    const veteran = subject(null, [SOLDIER_JOB]);
    expect(settlerMeetsNeed(sim.world, ctx, soldier, 'job', SWORD_SOLDIER_JOB)).toBe(true);
    expect(settlerMeetsNeed(sim.world, ctx, veteran, 'job', SWORD_SOLDIER_JOB)).toBe(true);
    expect(settlerMeetsNeed(sim.world, ctx, soldier, 'job', HERO_JOB)).toBe(false);
    expect(settlerMeetsNeed(sim.world, ctx, subject(HERO_JOB), 'job', SOLDIER_JOB)).toBe(false);
  });
});

describe('jobEnables tech-graph under the profession-progression toggle', () => {
  it('bypasses the presence graph for goods while off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    // Gated while progression is on: the fixture gates the plank on a woodcutter, and none is alive.
    expect(goodEnabled(sim.world, ctx, undefined, 1, 2)).toBe(false);

    setProfessionProgression(sim.world, false);
    expect(goodEnabled(sim.world, ctx, undefined, 1, 2)).toBe(true); // free start
  });
});
