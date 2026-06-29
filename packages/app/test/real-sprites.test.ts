import { describe, expect, it } from 'vitest';
import { buildHumanBindings, buildingBobsByType, directionalAnimFromSeq } from '../src/real-sprites.js';

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

  it('falls back to the transcribed house table when no buildingBobs map is supplied', () => {
    // An absent IR (a checkout without content/) → buildHumanBindings is called with no second arg →
    // the binding uses the committed VIKING_HOUSE01_BOBS constant (houses.ini [GfxHouse], LogicTribeType
    // 1, GfxPalette "house01"). Pins the fallback so a stale/typo'd constant is caught here, not by eye.
    expect(buildHumanBindings(new Map()).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('overlays a supplied buildingBobs map onto the constant — data wins per type, constant backs the rest', () => {
    // Live path: real data overrides per type (home 6 → a different bob) and adds growth-stage types
    // (2); the constant types the data does NOT cover (10/11/15) stay backed by VIKING_HOUSE01_BOBS, so
    // a partial IR degrades type-by-type instead of dropping the whole family to the generic box.
    expect(buildHumanBindings(new Map(), { 6: 999, 2: 1 }).building).toEqual({
      byType: { 6: 999, 10: 131, 11: 91, 12: 60, 15: 105, 2: 1 },
      default: 11,
    });
    // An empty map (the loaded atlas had no matching rows) degrades to exactly the transcribed constant.
    expect(buildHumanBindings(new Map(), {}).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
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

describe('buildingBobsByType', () => {
  // A slice of the real content/ir.json buildingBobs lane (extractBuildingBobs over houses.ini): the
  // viking home growth chain is distinct typeIds 2..6 (one bob each), the well/hive carry a duplicate
  // (lumped) row, and a frank row from another atlas must be filtered out.
  const rows = [
    { typeId: 2, level: 0, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house01', bobId: 1 },
    { typeId: 6, level: 4, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house01', bobId: 41 },
    { typeId: 10, level: 0, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house01', bobId: 131 },
    { typeId: 10, level: 0, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house01', bobId: 131 },
    { typeId: 12, level: 0, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house01', bobId: 60 },
    // other palette in the same .bmd — must be excluded
    { typeId: 6, level: 4, bmd: 'data/.../ls_houses_viking.bmd', paletteName: 'house02', bobId: 999 },
    // other .bmd (a frank house) — must be excluded
    { typeId: 6, level: 4, bmd: 'data/.../ls_houses_frank.bmd', paletteName: 'house01', bobId: 888 },
  ];

  it('reduces the join to typeId -> bob for the matching (bmd, palette) family', () => {
    expect(buildingBobsByType(rows, 'ls_houses_viking.bmd', 'house01')).toEqual({
      2: 1,
      6: 41,
      10: 131,
      12: 60,
    });
  });

  it('picks the highest level per typeId (deterministic tiebreak for multi-level / lumped dupes)', () => {
    const multi = [
      { typeId: 6, level: 2, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 21 },
      { typeId: 6, level: 4, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 41 },
      { typeId: 6, level: 0, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 1 },
    ];
    expect(buildingBobsByType(multi, 'ls_houses_viking.bmd', 'house01')).toEqual({ 6: 41 });
  });

  it('returns {} when no row matches the loaded atlas (caller then uses the constant fallback)', () => {
    expect(buildingBobsByType(rows, 'ls_houses_egypt.bmd', 'house01')).toEqual({});
    expect(buildingBobsByType([], 'ls_houses_viking.bmd', 'house01')).toEqual({});
  });

  it('on an equal-level tie keeps the lowest bobId regardless of row order (insertion-independent)', () => {
    const hi = { typeId: 7, level: 1, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 70 };
    const lo = { typeId: 7, level: 1, bmd: 'x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 50 };
    expect(buildingBobsByType([hi, lo], 'ls_houses_viking.bmd', 'house01')).toEqual({ 7: 50 });
    expect(buildingBobsByType([lo, hi], 'ls_houses_viking.bmd', 'house01')).toEqual({ 7: 50 });
  });

  it('anchors the bmd match to a path separator (no basename-concat false positive)', () => {
    const tricky = [
      { typeId: 1, level: 0, bmd: 'data/x/ls_houses_viking.bmd', paletteName: 'house01', bobId: 5 },
      // ends with the basename string but NOT after a `/` — must be excluded.
      { typeId: 2, level: 0, bmd: 'data/x/evil_ls_houses_viking.bmd', paletteName: 'house01', bobId: 9 },
    ];
    expect(buildingBobsByType(tricky, 'ls_houses_viking.bmd', 'house01')).toEqual({ 1: 5 });
  });
});
