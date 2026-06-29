import { describe, expect, it } from 'vitest';
import { buildHumanBindings, directionalAnimFromSeq } from '../src/real-sprites.js';

/**
 * The seq→frame-range math behind `?atlas=real` — the self-verifiable half of consuming the decoded
 * `bobSequences` (the `extractBobSequences` pipeline leg). The browser half (do the pixels animate
 * right?) is the gather-resource / angled-path acceptance scenes; this proves the range derivation +
 * the graceful fallback deterministically, without a browser.
 */

const FALLBACK = { start: 1, dirs: 8, stride: 99 } as const;

describe('directionalAnimFromSeq', () => {
  it('derives start + stride (= length / DIRS) from a named sequence', () => {
    const seqs = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(seqs, 'walk', {}, FALLBACK)).toEqual({ start: 1988, dirs: 8, stride: 12 });
  });

  it('applies the render-taste overrides (frames / phaseStart) on top of the extracted range', () => {
    const seqs = new Map([['chop', { name: 'chop', start: 5106, length: 120 }]]);
    expect(directionalAnimFromSeq(seqs, 'chop', { phaseStart: 9 }, FALLBACK)).toEqual({
      start: 5106,
      dirs: 8,
      stride: 15,
      phaseStart: 9,
    });
    const walk = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(walk, 'walk', { frames: 1 }, FALLBACK)).toEqual({
      start: 1988,
      dirs: 8,
      stride: 12,
      frames: 1,
    });
  });

  it('falls back verbatim when the sequence is absent or zero-length (a partial/old manifest)', () => {
    const empty = new Map<string, { name: string; start: number; length: number }>();
    expect(directionalAnimFromSeq(empty, 'walk', {}, FALLBACK)).toBe(FALLBACK);
    const zero = new Map([['walk', { name: 'walk', start: 1988, length: 0 }]]);
    expect(directionalAnimFromSeq(zero, 'walk', {}, FALLBACK)).toBe(FALLBACK);
  });
});

describe('buildHumanBindings', () => {
  it('derives the settler walk/chop/carry anims from the decoded sequences', () => {
    const seqs = new Map([
      ['human_man_generic_walk', { name: 'human_man_generic_walk', start: 1988, length: 96 }],
      [
        'human_man_woodcutter_work_woodcutting',
        { name: 'human_man_woodcutter_work_woodcutting', start: 5106, length: 120 },
      ],
      ['human_man_generic_walk_wood', { name: 'human_man_generic_walk_wood', start: 4580, length: 96 }],
    ]);
    const bindings = buildHumanBindings(seqs);
    expect(bindings.settler).toEqual({
      idle: { start: 1988, dirs: 8, stride: 12, frames: 1 },
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });

  it('falls back to the known-good ranges when the manifest is empty (fallback == data)', () => {
    // The committed FALLBACK_* ranges must equal what the real animations.ini yields, so a checkout
    // without content/ draws the same cycles as one with it. Asserting the empty-map result pins that.
    expect(buildHumanBindings(new Map()).settler).toEqual({
      idle: { start: 1988, dirs: 8, stride: 12, frames: 1 },
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });
});
