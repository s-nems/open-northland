import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AtlasFrame, SpriteAtlas, SpriteLayer } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { findCharacter } from '../src/catalog/roster.js';
import { BODY_IMAGELIB, type BobSeqRow } from '../src/content/ir.js';
import {
  buildAnimCells,
  buildGalleryClips,
  buildHeadsCells,
  buildRosterCells,
  parseDirection,
  parseView,
  prettyClipLabel,
  rosterLabel,
} from '../src/entries/anim-cells.js';

/** A minimal {@link SpriteLayer} for the pure cell-builder tests: only `.atlas.frames` is read; the GPU
 *  `source` is a stub (the builders pass the layer through by reference, never touch its texture). */
const frameAt = (present: boolean): AtlasFrame =>
  present
    ? { x: 0, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 }
    : { x: 0, y: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 };
function fakeLayer(frames: Iterable<[number, AtlasFrame]> = []): SpriteLayer {
  return { atlas: { width: 1, height: 1, frames: new Map(frames) }, source: {} as SpriteLayer['source'] };
}

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

describe('parseView', () => {
  it('maps heads/looks/glowy to the looks montage, everything else to the animation view', () => {
    for (const raw of ['heads', 'looks', 'glowy']) expect(parseView(raw)).toBe('heads');
    for (const raw of [null, 'anim', 'x', '']) expect(parseView(raw)).toBe('anim');
  });
});

describe('buildAnimCells', () => {
  const rows: BobSeqRow[] = [
    { name: 'human_man_generic_walk', start: 1988, length: 96 },
    { name: 'human_man_generic_eat', start: 1530, length: 17 },
  ];

  it('makes one cell per sequence, each drawn body + default head', () => {
    const head = fakeLayer([[1988, frameAt(true)]]);
    const body = fakeLayer();
    const cells = buildAnimCells(rows, body, head);
    expect(cells.map((c) => c.clip.label)).toEqual(['generic walk', 'generic eat']);
    expect(cells.every((c) => c.body === body)).toBe(true);
    expect(cells.every((c) => c.overlays?.[0] === head)).toBe(true);
  });

  it('drops the overlay (body-only) when the character has no head', () => {
    const cells = buildAnimCells(rows, fakeLayer(), undefined);
    expect(cells[0]?.overlays).toEqual([]);
  });
});

describe('buildHeadsCells', () => {
  // The warrior body's broadsword walk (×8) is the clip the montage should latch onto over the wait/attack.
  const rows: BobSeqRow[] = [
    { name: 'human_man_Warrior_Broadsword_wait', start: 396, length: 22 },
    { name: 'human_man_Warrior_Broadsword_walk', start: 440, length: 96 },
  ];

  it('plays the walk once per head, captioned + aligned 1:1 to the head slots', () => {
    const warrior = findCharacter('warrior');
    const heads = warrior.headBmds.map(() => fakeLayer());
    const body = fakeLayer();
    const cells = buildHeadsCells(warrior, rows, body, heads);
    expect(cells.length).toBe(warrior.headBmds.length);
    expect(cells.map((c) => c.label)).toEqual(['Głowa 05', 'Głowa 06', 'Głowa 07', 'Głowa 08']);
    // Every cell plays the SAME walk clip (start 440, ×8) with its own head over the shared body.
    expect(cells.every((c) => c.clip.start === 440 && c.clip.dirs === 8 && c.body === body)).toBe(true);
    expect(cells.map((c) => c.overlays?.[0])).toEqual(heads);
  });

  it('filters the looks by head label / bmd substring', () => {
    const warrior = findCharacter('warrior');
    const heads = warrior.headBmds.map(() => fakeLayer());
    const cells = buildHeadsCells(warrior, rows, fakeLayer(), heads, '07');
    expect(cells.map((c) => c.label)).toEqual(['Głowa 07']);
  });

  it('returns [] when the body has no playable clip', () => {
    expect(buildHeadsCells(findCharacter('warrior'), [], fakeLayer(), [])).toEqual([]);
  });

  it('emits one bare body-only cell for a headless character (the baby)', () => {
    const baby = findCharacter('baby');
    expect(baby.headBmds).toEqual([]); // body-only creature
    const cells = buildHeadsCells(
      baby,
      [{ name: 'human_child_baby_generic_crouch', start: 0, length: 104 }],
      fakeLayer(),
      [],
    );
    expect(cells.length).toBe(1);
    expect(cells[0]?.label).toBe('Niemowlę');
    expect(cells[0]?.overlays).toEqual([]); // no head overlay
  });
});

describe('rosterLabel', () => {
  it('appends the head index for a multi-look body, and is bare for a single-look body', () => {
    // Use each character's OWN heads (civilian owns 00–03/80–83/90–93; the woman is single-look).
    expect(rosterLabel(findCharacter('civilian'), 'cr_hum_head_02')).toBe('Cywil 02');
    expect(rosterLabel(findCharacter('warrior'), 'cr_hum_head_05')).toBe('Wojownik 05');
    expect(rosterLabel(findCharacter('woman'), 'cr_hum_head_10')).toBe('Kobieta');
  });
});

describe('buildRosterCells', () => {
  const civ = findCharacter('civilian');
  const woman = findCharacter('woman');
  const load = () => [
    {
      char: civ,
      body: fakeLayer(),
      heads: civ.headBmds.map(() => fakeLayer()),
      rows: [{ name: 'human_man_generic_walk', start: 1988, length: 96 }],
    },
    {
      char: woman,
      body: fakeLayer(),
      heads: [fakeLayer()],
      rows: [{ name: 'human_woman_generic_walk', start: 504, length: 96 }],
    },
  ];

  it('emits one walking cell per look across the whole roster, captioned per character', () => {
    const cells = buildRosterCells(load());
    expect(cells.length).toBe(civ.headBmds.length + 1); // every civilian look + the single woman look
    expect(cells[0]?.label).toBe('Cywil 00');
    expect(cells[0]?.clip.start).toBe(1988); // the civilian walk
    expect(cells.at(-1)?.label).toBe('Kobieta');
    expect(cells.at(-1)?.clip.start).toBe(504); // the woman walk
  });

  it('filters looks by caption, and skips a character with no playable clip', () => {
    expect(buildRosterCells(load(), 'kobieta').map((c) => c.label)).toEqual(['Kobieta']);
    const noClip = [{ char: woman, body: fakeLayer(), heads: [fakeLayer()], rows: [] }];
    expect(buildRosterCells(noClip)).toEqual([]);
  });

  it('emits one bare body-only cell for a headless character (the baby)', () => {
    const baby = findCharacter('baby');
    const cells = buildRosterCells([
      {
        char: baby,
        body: fakeLayer(),
        heads: [],
        rows: [{ name: 'human_child_baby_generic_crouch', start: 0, length: 104 }],
      },
    ]);
    expect(cells.length).toBe(1);
    expect(cells[0]?.label).toBe('Niemowlę');
    expect(cells[0]?.overlays).toEqual([]);
    expect(cells[0]?.clip.start).toBe(0); // the crouch (baby has no _walk)
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
