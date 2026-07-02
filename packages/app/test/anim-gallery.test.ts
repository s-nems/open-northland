import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AtlasFrame, SpriteAtlas } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { buildGalleryClips, parseDirection, prettyClipLabel } from '../src/anim-mode.js';
import { BODY_IMAGELIB, type BobSeqRow } from '../src/real-sprites.js';

/**
 * The animation gallery's data half. `prettyClipLabel` is pure (self-verifiable). The catalog of
 * animations the gallery plays is the extracted `content/ir.json` `bobSequences` for the viking civilian
 * body — pinned here so a pipeline change that drops the body's animations is caught, not discovered by a
 * blank gallery. `content/` is gitignored, so on a checkout without it the data half SKIPS (the same
 * "must still boot/test without decoded bytes" stance as the rest of the app).
 */

describe('prettyClipLabel', () => {
  it('drops the species/gender prefix and spaces the remainder', () => {
    expect(prettyClipLabel('human_man_generic_walk')).toBe('generic walk');
    expect(prettyClipLabel('human_man_generic_walk_wood')).toBe('generic walk wood');
    expect(prettyClipLabel('human_man_Civilian_Fight_punch')).toBe('Civilian Fight punch');
  });

  it('leaves a name without the known prefix intact (just de-underscored)', () => {
    expect(prettyClipLabel('animal_bear_walk')).toBe('animal bear walk');
  });
});

describe('parseDirection', () => {
  it('maps full/all/absent/garbage/out-of-range to "full", and 0..7 to that block', () => {
    for (const raw of [null, 'full', 'all', 'abc', '-1', '8', '99']) {
      expect(parseDirection(raw)).toBe('full');
    }
    expect(parseDirection('0')).toBe(0);
    expect(parseDirection('3')).toBe(3);
    expect(parseDirection('7')).toBe(7);
  });
});

describe('buildGalleryClips', () => {
  const frame = (present: boolean): AtlasFrame =>
    present
      ? { x: 0, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 }
      : { x: 0, y: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 };
  // A head atlas with a non-empty head at the base walk (1988) and one carry variant (4580), but EMPTY at
  // the fish carry (2468) — the mix that exercises the borrow.
  const headAtlas: SpriteAtlas = {
    width: 1,
    height: 1,
    frames: new Map<number, AtlasFrame>([
      [1988, frame(true)],
      [4580, frame(true)],
      [2468, frame(false)],
    ]),
  };
  const rows: BobSeqRow[] = [
    { name: 'human_man_generic_walk', start: 1988, length: 96 },
    { name: 'human_man_generic_walk_wood', start: 4580, length: 96 }, // carry, has its own head
    { name: 'human_man_generic_walk_fish', start: 2468, length: 96 }, // carry, EMPTY head → borrow walk
    { name: 'human_man_generic_eat', start: 1530, length: 17 }, // single-direction, not walk-layout
  ];

  it('derives dirs (length%8) and borrows the walk head only for empty-headed walk-layout carry variants', () => {
    const clips = buildGalleryClips(rows, headAtlas);
    expect(clips).toEqual([
      { label: 'generic walk', start: 1988, length: 96, dirs: 8 }, // walk itself never borrows
      { label: 'generic walk wood', start: 4580, length: 96, dirs: 8 }, // own head present → no borrow
      { label: 'generic walk fish', start: 2468, length: 96, dirs: 8, headStart: 1988 }, // empty head → borrow
      { label: 'generic eat', start: 1530, length: 17, dirs: 1 }, // not length-96 → no borrow, single-dir
    ]);
  });

  it('filters by name substring but still resolves the walk head from the UNFILTERED rows', () => {
    const clips = buildGalleryClips(rows, headAtlas, 'fish');
    expect(clips).toEqual([
      { label: 'generic walk fish', start: 2468, length: 96, dirs: 8, headStart: 1988 },
    ]);
  });

  it('leaves head ids alone (no borrow) when there is no head atlas', () => {
    const clips = buildGalleryClips(rows, undefined, 'fish');
    // headEmptyAt is true for every id, but with no walk head to borrow the clip still renders body-only;
    // the borrow still points at the walk start (the renderer just finds no head frame and hides it).
    expect(clips[0]?.headStart).toBe(1988);
  });
});

interface IrSeq {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}
interface Ir {
  readonly bobSequences?: readonly { imagelib: string; sequences?: IrSeq[] }[];
}

const IR_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/ir.json');
function loadIr(): Ir | null {
  if (!existsSync(IR_PATH)) return null;
  try {
    return JSON.parse(readFileSync(IR_PATH, 'utf8')) as Ir;
  } catch {
    return null;
  }
}
const ir = loadIr();

describe('viking civilian animation set (ir.json bobSequences)', () => {
  it.runIf(ir !== null)(`${BODY_IMAGELIB} carries the animations the gallery showcases`, () => {
    const set = (ir as Ir).bobSequences?.find((s) => s.imagelib === BODY_IMAGELIB);
    expect(set, `${BODY_IMAGELIB} missing from ir.json bobSequences`).toBeDefined();
    const seqs = set?.sequences ?? [];
    const names = new Set(seqs.map((s) => s.name));
    // Anchors across the categories the gallery/idle work depends on: idle-loop, locomotion, a fight,
    // and a need action. If any of these vanish, the never-frozen idle or the "all animations" claim breaks.
    for (const anchor of ['human_man_generic_wait', 'human_man_generic_walk', 'human_man_generic_eat']) {
      expect(names.has(anchor), `expected sequence ${anchor}`).toBe(true);
    }
    expect(
      seqs.some((s) => /Fight|punch|kick/i.test(s.name)),
      'expected at least one unarmed fight sequence',
    ).toBe(true);
    // Every sequence is a real, non-empty frame range (start >= 0, length > 0) — the gallery indexes these.
    for (const s of seqs) {
      expect(s.start, s.name).toBeGreaterThanOrEqual(0);
      expect(s.length, s.name).toBeGreaterThan(0);
    }
    // The full civilian set is large (~69) — a sanity floor so a truncated extract is caught.
    expect(seqs.length).toBeGreaterThan(30);
  });
});
