import { describe, expect, it } from 'vitest';
import { goodUnlockedFor } from '../src/game/profession-unlocks.js';

/** The details panel's product filter - the app-side mirror of the sim's `settlerMeetsNeed`
 *  `needforgood` reading (same rows, same repeats arithmetic). */
describe('goodUnlockedFor', () => {
  const COLLECTOR = 8;
  const CARPENTER = 9;
  const WOOD_TRACK = 3;
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
    jobs: [
      { typeId: COLLECTOR, id: 'collector', allowedAtomics: [], forbiddenAtomics: [] },
      { typeId: CARPENTER, id: 'joiner', allowedAtomics: [], forbiddenAtomics: [] },
    ],
  };

  it('gates a needforgood ware by repeats, and the toggle frees every good (no carve-out)', () => {
    expect(goodUnlockedFor(content, true, 1, new Map(), PLAIN_GOOD)).toBe(true); // ungated ware
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 99]]), SWORD_GOOD)).toBe(false);
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 100]]), SWORD_GOOD)).toBe(true);
    expect(goodUnlockedFor(content, false, 1, new Map(), SWORD_GOOD)).toBe(true); // goods are civilian
  });
});
