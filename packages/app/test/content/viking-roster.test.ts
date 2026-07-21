import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clipDirs, GALLERY_DIRS } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  characterStem,
  characterStems,
  DEFAULT_CHARACTER_PALETTE,
  pickWalkRow,
  VIKING_CHARACTERS,
} from '../../src/catalog/roster.js';
import type { BobSeqRow } from '../../src/content/ir/rows.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Pins that the decoded content actually carries every body imagelib + head/body atlas the roster
 * names, so a pipeline change that drops one is caught here, not by a headless cell or a 404 in the
 * browser. The roster's pure shape/transcription tests live with the fixture suite
 * (`test/viking-roster.test.ts`); this is their real-content half.
 */

interface Ir {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
}

describe.runIf(hasRealIr())('roster is backed by decoded content', () => {
  it('every roster body imagelib carries a playable ×8 montage clip', () => {
    const byLib = new Map((rawIrUnderTest() as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
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

  it('every head look composes over its body walk range (no headless cell)', () => {
    const bobs = resolve(contentDir(), 'Data/engine2d/bin/bobs');
    if (!existsSync(bobs)) return;
    const byLib = new Map((rawIrUnderTest() as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
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

  it('the warrior body carries the armed attack sequences', () => {
    const byLib = new Map((rawIrUnderTest() as Ir).bobSequences?.map((s) => [s.imagelib, s.sequences ?? []]));
    const names = new Set((byLib.get('cr_hum_body_05.bmd') ?? []).map((s) => s.name));
    for (const anchor of [
      'human_man_Warrior_Broadsword_attack',
      'human_man_Warrior_Longbow_attack',
      'human_man_Warrior_Broadsword_walk',
    ]) {
      expect(names.has(anchor), `expected warrior sequence ${anchor}`).toBe(true);
    }
  });

  it('every roster body + head atlas is decoded on disk (no 404 in the gallery)', () => {
    const bobs = resolve(contentDir(), 'Data/engine2d/bin/bobs');
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
