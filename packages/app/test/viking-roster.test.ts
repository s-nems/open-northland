import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GALLERY_DIRS, clipDirs } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER,
  DEFAULT_CHARACTER_PALETTE,
  VIKING_CHARACTERS,
  characterStem,
  characterStems,
  findCharacter,
  headLabel,
  pickWalkRow,
} from '../src/catalog/roster.js';
import type { BobSeqRow } from '../src/content/ir.js';

/**
 * The viking roster's data half — pure and self-verifiable. The roster is transcribed from the mod's
 * `jobgraphics.ini`; these guards pin (a) the shape/consistency of the transcription and (b) that the
 * decoded `content/` actually carries every body imagelib + head/body atlas the roster names, so a
 * pipeline change that drops one is caught here, not by a headless cell or a 404 in the browser. The
 * `content/`-backed checks SKIP on a checkout without decoded bytes (the app's standing stance).
 */

describe('findCharacter', () => {
  it('resolves a known id and falls back to the civilian for absent/unknown', () => {
    expect(findCharacter('warrior').id).toBe('warrior');
    expect(findCharacter(null)).toBe(DEFAULT_CHARACTER);
    expect(findCharacter('nope')).toBe(DEFAULT_CHARACTER);
    expect(DEFAULT_CHARACTER.id).toBe('civilian');
  });
});

describe('character stems', () => {
  it('appends the palette to a bmd stem', () => {
    expect(characterStem('cr_hum_body_05')).toBe('cr_hum_body_05.test_human_00');
    expect(characterStem('cr_hum_head_10', 'egypt_soldier')).toBe('cr_hum_head_10.egypt_soldier');
  });

  it('resolves a character to its body + head stems in roster order', () => {
    const warrior = findCharacter('warrior');
    const { bodyStem, headStems } = characterStems(warrior);
    expect(bodyStem).toBe('cr_hum_body_05.test_human_00');
    expect(headStems).toEqual([
      'cr_hum_head_05.test_human_00',
      'cr_hum_head_06.test_human_00',
      'cr_hum_head_07.test_human_00',
      'cr_hum_head_08.test_human_00',
    ]);
  });
});

describe('headLabel', () => {
  it('reads the head index out of the bmd stem', () => {
    expect(headLabel('cr_hum_head_08')).toBe('Głowa 08');
    expect(headLabel('cr_hum_head_93')).toBe('Głowa 93');
    expect(headLabel('something_else')).toBe('something_else');
  });
});

describe('pickWalkRow', () => {
  const row = (name: string, length: number): BobSeqRow => ({ name, start: 0, length });

  it('prefers a plain ×8 "_walk" over an agressive/carry variant', () => {
    const rows = [
      row('human_man_Warrior_Broadsword_wait', 22),
      row('human_man_Warrior_Broadsword_walk_agressive', 96),
      row('human_man_Warrior_Broadsword_walk', 96),
    ];
    expect(pickWalkRow(rows)?.name).toBe('human_man_Warrior_Broadsword_walk');
  });

  it('falls back to the longest ×8 clip when no "_walk" exists (the baby has only crouch)', () => {
    const rows = [row('human_child_baby_generic_wait', 42), row('human_child_baby_generic_crouch', 104)];
    expect(pickWalkRow(rows)?.name).toBe('human_child_baby_generic_crouch');
  });

  it('falls back to the first row when nothing is ×8, and is undefined for []', () => {
    expect(pickWalkRow([row('a', 7), row('b', 5)])?.name).toBe('a');
    expect(pickWalkRow([])).toBeUndefined();
  });
});

describe('roster shape', () => {
  it('has unique ids and well-formed body/head/imagelib names', () => {
    const ids = VIKING_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of VIKING_CHARACTERS) {
      expect(c.bodyBmd, c.id).toMatch(/^cr_hum_body_\d{2}$/);
      expect(c.imagelib, c.id).toBe(`${c.bodyBmd}.bmd`);
      // headBmds MAY be empty (a body-only creature); every listed head is well-formed.
      for (const h of c.headBmds) expect(h, c.id).toMatch(/^cr_hum_head_\d{2}$/);
    }
    // The civilian carries multiple looks (the heads montage is meaningful); the baby is body-only.
    expect(findCharacter('civilian').headBmds.length).toBeGreaterThan(1);
    expect(findCharacter('baby').headBmds).toEqual([]);
  });

  it('includes the warrior with its combat body and several looks', () => {
    const warrior = findCharacter('warrior');
    expect(warrior.imagelib).toBe('cr_hum_body_05.bmd');
    expect(warrior.headBmds.length).toBe(4);
  });
});

interface Ir {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
}
const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content');
function loadIr(): Ir | null {
  const p = resolve(CONTENT, 'ir.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Ir;
  } catch {
    return null;
  }
}
const ir = loadIr();

describe('roster is backed by decoded content', () => {
  it.runIf(ir !== null)('every roster body imagelib carries a playable ×8 montage clip', () => {
    const byLib = new Map((ir as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
    for (const c of VIKING_CHARACTERS) {
      const seqs = byLib.get(c.imagelib);
      expect(seqs, `${c.imagelib} missing from ir.json bobSequences`).toBeDefined();
      // The montage's direction selector needs a ×8 clip; assert pickWalkRow lands on one (not just any row
      // via its rows[0] fallback), else the "turn to face N…NW" would be a silent no-op for that body.
      const walk = pickWalkRow(seqs ?? []);
      expect(walk, `${c.id} has no playable clip`).toBeDefined();
      expect(walk && clipDirs(walk.length), `${c.id} montage clip is not ×8 directional`).toBe(GALLERY_DIRS);
    }
  });

  it.runIf(ir !== null)('every head look composes over its body walk range (no headless cell)', () => {
    const bobs = resolve(CONTENT, 'Data/engine2d/bin/bobs');
    if (!existsSync(bobs)) return;
    const byLib = new Map((ir as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
    interface AtlasFrameLite {
      readonly bobId: number;
      readonly rect: { readonly width: number; readonly height: number };
    }
    for (const c of VIKING_CHARACTERS) {
      const walk = pickWalkRow(byLib.get(c.imagelib) ?? []);
      if (walk === undefined) continue;
      // A body-only character (the baby) has no head → exempt; a listed head MUST draw at the walk's first
      // bob, else the montage/anim shows a headless body while the checklist claims "no headless cell".
      for (const h of c.headBmds) {
        const stem = characterStem(h);
        const p = resolve(bobs, `${stem}.atlas.json`);
        if (!existsSync(p)) continue; // file existence is the other guard's concern
        const frames = (JSON.parse(readFileSync(p, 'utf8')).frames ?? []) as AtlasFrameLite[];
        const atStart = frames.find((f) => f.bobId === walk.start);
        expect(
          atStart !== undefined && atStart.rect.width > 0,
          `${stem} draws no head at walk.start ${walk.start} (body ${c.imagelib}) → headless cell`,
        ).toBe(true);
      }
    }
  });

  it.runIf(ir !== null)('the warrior body carries the armed attack sequences', () => {
    const byLib = new Map((ir as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
    const names = new Set((byLib.get('cr_hum_body_05.bmd') ?? []).map((s) => s.name));
    for (const anchor of [
      'human_man_Warrior_Broadsword_attack',
      'human_man_Warrior_Longbow_attack',
      'human_man_Warrior_Broadsword_walk',
    ]) {
      expect(names.has(anchor), `expected warrior sequence ${anchor}`).toBe(true);
    }
  });

  it.runIf(ir !== null)('every roster body + head atlas is decoded on disk (no 404 in the gallery)', () => {
    const bobs = resolve(CONTENT, 'Data/engine2d/bin/bobs');
    // Skip if the bobs dir itself isn't present (partial content/).
    if (!existsSync(bobs)) return;
    for (const c of VIKING_CHARACTERS) {
      const { bodyStem, headStems } = characterStems(c, DEFAULT_CHARACTER_PALETTE);
      for (const stem of [bodyStem, ...headStems]) {
        expect(existsSync(resolve(bobs, `${stem}.atlas.json`)), `${stem}.atlas.json`).toBe(true);
        expect(existsSync(resolve(bobs, `${stem}.png`)), `${stem}.png`).toBe(true);
      }
    }
  });
});
