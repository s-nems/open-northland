import { describe, expect, it } from 'vitest';
import { goodUnlockedFor, jobUnlockedFor } from '../src/game/profession-unlocks.js';

/** The picker's qualification filter - the app-side mirror of the sim's `settlerMeetsNeed` need-job
 *  reading (same rows, same repeats arithmetic; the `setJob` command enforces the identical gate). */
describe('jobUnlockedFor', () => {
  const COLLECTOR = 8;
  const CARPENTER = 9;
  const SOLDIER = 33; // a `soldier_*` trade - the fighter carve-out's target
  const WOOD_TRACK = 3;
  /** The TRAINING bucket every `trainfor*` row reads - the barracks drill's schooling. */
  const TRAINING_TRACK = 77;
  const SWORD_GOOD = 52; // a needforgood-gated ware
  const PLAIN_GOOD = 5; // no requirement row
  const VIKING_TRIBE = {
    typeId: 1,
    id: 'viking',
    hitpoints: 0,
    atomicBindings: [],
    jobEnables: [],
    jobRequirements: [
      {
        requirement: 'need' as const,
        target: 'job' as const,
        targetId: CARPENTER,
        amount: 10,
        experienceTypes: [WOOD_TRACK],
      },
      {
        requirement: 'need' as const,
        target: 'job' as const,
        targetId: SOLDIER,
        amount: 5,
        experienceTypes: [72],
      },
      {
        requirement: 'need' as const,
        target: 'good' as const,
        targetId: SWORD_GOOD,
        amount: 10,
        experienceTypes: [WOOD_TRACK],
      },
    ],
  };
  const content = {
    tribes: [VIKING_TRIBE],
    jobExperience: [
      { typeId: WOOD_TRACK, id: 'collector_wood', jobType: COLLECTOR, goodTypes: [5], experienceFactor: 10 },
    ],
    // The fighter carve-out reads its role off the job id slug, so the rows carry the real vocabulary.
    jobs: [
      { typeId: COLLECTOR, id: 'collector', allowedAtomics: [], forbiddenAtomics: [] },
      { typeId: CARPENTER, id: 'joiner', allowedAtomics: [], forbiddenAtomics: [] },
      { typeId: SOLDIER, id: 'soldier_spear_iron', allowedAtomics: [], forbiddenAtomics: [] },
    ],
  };

  it('offers ungated trades freely and gated ones only at the repeats threshold', () => {
    expect(jobUnlockedFor(content, true, 1, new Map(), COLLECTOR)).toBe(true); // base trade
    expect(jobUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 99]]), CARPENTER)).toBe(false); // 9 repeats
    expect(jobUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 100]]), CARPENTER)).toBe(true); // 10 repeats
  });

  it('frees civilian trades while progression is off, but never the fighter trades', () => {
    expect(jobUnlockedFor(content, false, 1, new Map(), CARPENTER)).toBe(true);
    expect(jobUnlockedFor(content, false, 1, new Map(), SOLDIER)).toBe(false); // barracks territory
  });

  it('offers a fighter trade once the barracks schooling is paid, toggle either way', () => {
    // The soldier's own `trainforjob` row: TRAINING is a track-less bucket, so raw XP is the repeat count.
    const schooled = {
      ...content,
      tribes: [
        {
          ...VIKING_TRIBE,
          jobRequirements: [
            ...VIKING_TRIBE.jobRequirements,
            {
              requirement: 'train' as const,
              target: 'job' as const,
              targetId: SOLDIER,
              amount: 5,
              experienceTypes: [TRAINING_TRACK],
            },
          ],
        },
      ],
    };
    expect(jobUnlockedFor(schooled, true, 1, new Map([[TRAINING_TRACK, 4]]), SOLDIER)).toBe(false);
    expect(jobUnlockedFor(schooled, true, 1, new Map([[TRAINING_TRACK, 5]]), SOLDIER)).toBe(true);
    expect(jobUnlockedFor(schooled, false, 1, new Map([[TRAINING_TRACK, 5]]), SOLDIER)).toBe(true);
  });

  it('gates a needforgood ware by repeats, and the toggle frees every good (no carve-out)', () => {
    expect(goodUnlockedFor(content, true, 1, new Map(), PLAIN_GOOD)).toBe(true); // ungated ware
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 99]]), SWORD_GOOD)).toBe(false);
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 100]]), SWORD_GOOD)).toBe(true);
    expect(goodUnlockedFor(content, false, 1, new Map(), SWORD_GOOD)).toBe(true); // goods are civilian
  });
});
