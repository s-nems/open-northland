import { describe, expect, it } from 'vitest';
import { goodUnlockedFor, jobUnlockedFor, jobUnlockedForSelection } from '../src/game/profession-unlocks.js';
import { snapshotOf } from './support/sandbox.js';

/** The picker's qualification filter — the app-side mirror of the sim's `settlerMeetsNeed` need-job
 *  reading (same rows, same repeats arithmetic; the `setJob` command enforces the identical gate). */
describe('jobUnlockedFor', () => {
  const COLLECTOR = 8;
  const CARPENTER = 9;
  const SOLDIER = 33; // a `soldier_*` trade — the fighter carve-out's target
  const WOOD_TRACK = 3;
  const SWORD_GOOD = 52; // a needforgood-gated ware
  const PLAIN_GOOD = 5; // no requirement row
  const content = {
    tribes: [
      {
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
      },
    ],
    jobExperience: [
      { typeId: WOOD_TRACK, id: 'collector_wood', jobType: COLLECTOR, goodType: 5, experienceFactor: 10 },
    ],
    // The fighter carve-out reads its role off the job id slug, so the rows carry the real vocabulary.
    jobs: [
      { typeId: COLLECTOR, id: 'collector', allowedAtomics: [], baseAtomics: [], forbiddenAtomics: [] },
      { typeId: CARPENTER, id: 'joiner', allowedAtomics: [], baseAtomics: [], forbiddenAtomics: [] },
      {
        typeId: SOLDIER,
        id: 'soldier_spear_iron',
        allowedAtomics: [],
        baseAtomics: [],
        forbiddenAtomics: [],
      },
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

  it('gates a needforgood ware by repeats, and the toggle frees every good (no carve-out)', () => {
    expect(goodUnlockedFor(content, true, 1, new Map(), PLAIN_GOOD)).toBe(true); // ungated ware
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 99]]), SWORD_GOOD)).toBe(false);
    expect(goodUnlockedFor(content, true, 1, new Map([[WOOD_TRACK, 100]]), SWORD_GOOD)).toBe(true);
    expect(goodUnlockedFor(content, false, 1, new Map(), SWORD_GOOD)).toBe(true); // goods are civilian
  });

  it('requires the WHOLE selection to qualify, and reads the toggle off the snapshot', () => {
    const settler = (id: number, rawXp: number) => ({
      id,
      components: { Settler: { tribe: 1, jobType: COLLECTOR, experience: [[WOOD_TRACK, rawXp]] } },
    });
    const mixed = snapshotOf([settler(1, 100), settler(2, 50)]);
    expect(jobUnlockedForSelection(content, mixed, [1], CARPENTER)).toBe(true);
    expect(jobUnlockedForSelection(content, mixed, [1, 2], CARPENTER)).toBe(false); // #2 short

    const freeStart = snapshotOf([
      settler(1, 0),
      { id: 99, components: { ProgressionRules: { professionProgressionEnabled: false } } },
    ]);
    expect(jobUnlockedForSelection(content, freeStart, [1], CARPENTER)).toBe(true);
  });

  it('never gates an AI seat’s settler, whatever the toggle says', () => {
    const AI_SEAT = 2;
    const owned = (id: number, player: number) => ({
      id,
      components: {
        Settler: { tribe: 1, jobType: COLLECTOR, experience: [] },
        Owner: { player },
      },
    });
    const snapshot = snapshotOf([
      owned(1, 0), // the human's fresh collector
      owned(2, AI_SEAT), // a bot's fresh collector
      { id: 98, components: { AiPlayer: { player: AI_SEAT, modules: {} } } },
    ]);
    expect(jobUnlockedForSelection(content, snapshot, [1], CARPENTER)).toBe(false); // human earns it
    expect(jobUnlockedForSelection(content, snapshot, [2], CARPENTER)).toBe(true); // the bot does not
  });
});
