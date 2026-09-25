import { describe, expect, it } from 'vitest';
import { unmetGoodRequirement } from '../src/game/profession-unlocks.js';

/** The details panel's product filter - the app-side mirror of the sim's `settlerMeetsNeed`
 *  `needforgood` reading (same rows, same repeats arithmetic). */
describe('unmetGoodRequirement', () => {
  const COLLECTOR = 8;
  const CARPENTER = 9;
  const WOOD_TRACK = 3;
  const SWORD_GOOD = 52; // a needforgood-gated ware
  const PLAIN_GOOD = 5; // no requirement row
  const VIKING_TRIBE = {
    typeId: 1,
    id: 'viking',
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
      {
        typeId: WOOD_TRACK,
        id: 'collector_wood',
        jobType: COLLECTOR,
        goodTypes: [5],
        experienceFactor: 10,
        baseRepeatCounter: 10,
      },
    ],
    jobs: [
      { typeId: COLLECTOR, id: 'collector', allowedAtomics: [], forbiddenAtomics: [] },
      { typeId: CARPENTER, id: 'joiner', allowedAtomics: [], forbiddenAtomics: [] },
    ],
  };

  it('gates a needforgood ware by repeats, and the toggle frees every good (no carve-out)', () => {
    const unmet = (xp: number, good: number, enabled = true) =>
      unmetGoodRequirement(content, enabled, 1, new Map(xp > 0 ? [[WOOD_TRACK, xp]] : []), good);
    expect(unmet(0, PLAIN_GOOD)).toBeNull(); // ungated ware
    expect(unmet(99, SWORD_GOOD)).toEqual({ current: 9, required: 10, experienceTypes: [WOOD_TRACK] });
    expect(unmet(100, SWORD_GOOD)).toBeNull();
    expect(unmet(0, SWORD_GOOD, false)).toBeNull(); // goods are civilian
  });
});
