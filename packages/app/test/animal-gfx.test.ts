import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC } from '../src/catalog/atomics.js';
import { ADULT_ANIMAL_JOB, animalBinding, animalWalkSeqName } from '../src/content/animal-gfx/bindings.js';
import type { ContentIr } from '../src/content/ir/rows.js';

/**
 * The animal-look binding derivation: which walk/wait/fight rows a tribe resolves from the IR's
 * animal-job lanes, and how each wait shape (facing-locked strip vs per-direction frame lists) becomes
 * an idle. Shapes mirror the real extracted rows (bear/wolf/goat/hare); the pixel half is the
 * `wildlife` scene.
 */

const seqs = new Map([
  ['animal_bear_walk', { name: 'animal_bear_walk', start: 115, length: 128 }],
  ['animal_bear_wait', { name: 'animal_bear_wait', start: 88, length: 27 }],
  ['animal_bear_fight', { name: 'animal_bear_fight', start: 0, length: 88 }],
  ['animal_wolf_walk', { name: 'animal_wolf_walk', start: 3024, length: 96 }],
  ['animal_wolf_run', { name: 'animal_wolf_run', start: 2883, length: 104 }],
  ['animal_goat_walk', { name: 'animal_goat_walk', start: 1371, length: 96 }],
  ['animal_rabbit_walk', { name: 'animal_rabbit_walk', start: 2431, length: 64 }],
  ['animal_deer_male_wait', { name: 'animal_deer_male_wait', start: 963, length: 36 }],
]);

/** Eight per-`<dir>` lists whose single entry is its dir index, so the facing remap is assertable. */
const DIR_LISTS = Array.from({ length: 8 }, (_, dir) => [dir]);

const ADULT = ADULT_ANIMAL_JOB;
const BABY = 48; // `jobtypes.ini` baby_animal, the defensive fallback lane
const IDLE_ACTION = 2;

describe('animalWalkSeqName', () => {
  it('keeps the first clean ×8 walk row (the wolf authors walk before run)', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [
        { tribe: 20, job: ADULT, goodType: 0, bodySeq: 'animal_wolf_walk' },
        { tribe: 20, job: ADULT, goodType: 0, bodySeq: 'animal_wolf_run' },
      ],
    };
    expect(animalWalkSeqName(ir, 20, seqs)).toBe('animal_wolf_walk');
  });

  it('reads an adult-lane-only walk (the goat authors no baby row)', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [{ tribe: 14, job: ADULT, goodType: 0, bodySeq: 'animal_goat_walk' }],
    };
    expect(animalWalkSeqName(ir, 14, seqs)).toBe('animal_goat_walk');
  });

  it('falls back to the baby lane when only it is authored (synthetic; defensive)', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [{ tribe: 14, job: BABY, goodType: 0, bodySeq: 'animal_goat_walk' }],
    };
    expect(animalWalkSeqName(ir, 14, seqs)).toBe('animal_goat_walk');
  });
});

describe('animalBinding', () => {
  it('loops a single-list wait program facing-locked and binds the ×8 fight as a facing-remapped attack', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [{ tribe: 8, job: ADULT, goodType: 0, bodySeq: 'animal_bear_walk' }],
      gfxAtomics: [
        { tribe: 8, job: ADULT, action: IDLE_ACTION, bodySeq: 'animal_bear_wait', dirFrames: [[0, 1, 2]] },
        { tribe: 8, job: ADULT, action: ATTACK_ATOMIC, bodySeq: 'animal_bear_fight', dirFrames: DIR_LISTS },
      ],
    };
    const binding = animalBinding(ir, 8, seqs);
    // The wait's authored program loops facing-locked on the free tick (the breathing idle) - NOT the
    // raw strip: the real bear strip packs sniff/lie/sit poses back-to-back and only the program's
    // slice is the wait.
    expect(binding?.idle).toEqual({ start: 88, frameLists: [[0, 1, 2]], loop: true });
    expect(binding?.moving).toEqual({ start: 115, dirs: 8, stride: 16 });
    const attack = binding?.byAtomic?.[ATTACK_ATOMIC];
    if (attack === undefined || typeof attack === 'number' || !('frameLists' in attack)) {
      throw new Error('the fight row must bind as a FrameListAnim');
    }
    expect(attack.start).toBe(0);
    // dir 0 (screen-east) lands on facing 4 (E) under the shared dir→facing remap.
    expect(attack.frameLists[4]).toEqual([0]);
  });

  it('binds a per-direction wait as a looping facing-remapped frame list (the deer idle)', () => {
    const ir: ContentIr = {
      gfxAtomics: [
        {
          tribe: 11,
          job: ADULT,
          action: IDLE_ACTION,
          bodySeq: 'animal_deer_male_wait',
          dirFrames: DIR_LISTS,
        },
      ],
    };
    const idle = animalBinding(ir, 11, seqs)?.idle;
    if (idle === undefined || typeof idle === 'number' || !('frameLists' in idle)) {
      throw new Error('a per-direction wait must bind as a FrameListAnim');
    }
    expect(idle.start).toBe(963);
    expect(idle.frameLists[4]).toEqual([0]);
    expect(idle.loop).toBe(true); // the ear-flick program cycles instead of freezing after one pass
  });

  it('skips a wait row whose program is empty (falls through to the walk-hold pose)', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [{ tribe: 8, job: ADULT, goodType: 0, bodySeq: 'animal_bear_walk' }],
      gfxAtomics: [
        { tribe: 8, job: ADULT, action: IDLE_ACTION, bodySeq: 'animal_bear_wait', dirFrames: [[]] },
      ],
    };
    expect(animalBinding(ir, 8, seqs)?.idle).toEqual({ start: 115, dirs: 8, stride: 16, frames: 1 });
  });

  it('holds the walk first frame per facing when no wait row exists (synthetic; the real hare authors one-frame per-direction waits)', () => {
    const ir: ContentIr = {
      gfxWalkAtomics: [{ tribe: 16, job: ADULT, goodType: 0, bodySeq: 'animal_rabbit_walk' }],
    };
    expect(animalBinding(ir, 16, seqs)?.idle).toEqual({ start: 2431, dirs: 8, stride: 8, frames: 1 });
  });

  it('returns null for a tribe with no usable rows (stays unbound, never a bogus range)', () => {
    expect(animalBinding({}, 35, seqs)).toBeNull();
    // A wait row naming a sequence the body set does not author is equally unusable.
    const ir: ContentIr = {
      gfxAtomics: [
        { tribe: 22, job: ADULT, action: IDLE_ACTION, bodySeq: 'animal_missing', dirFrames: [[0]] },
      ],
    };
    expect(animalBinding(ir, 22, seqs)).toBeNull();
  });
});
