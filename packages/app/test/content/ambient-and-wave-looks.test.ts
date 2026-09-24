import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AMBIENT_LOOK_BY_TRIBE } from '../../src/catalog/animal-roster.js';
import { ADULT_ANIMAL_JOB } from '../../src/content/animal-gfx/bindings.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

/** The drawable bob ids of a served atlas, or null when the atlas is not served. */
function drawableBobIds(stem: string): Set<number> | null {
  const path = resolve(contentDir(), 'bobs', `${stem}.atlas.json`);
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    frames: { bobId: number; rect: { width: number; height: number } }[];
  };
  return new Set(manifest.frames.filter((f) => f.rect.width > 0 && f.rect.height > 0).map((f) => f.bobId));
}

describe.runIf(hasRealIr())('ambient creature and ground-wave looks', () => {
  it('every ambient species plays a sequence-less adult loop its served atlas draws', () => {
    const ir = rawIrUnderTest() as ContentIr;
    for (const [tribe, look] of AMBIENT_LOOK_BY_TRIBE) {
      const loop = (ir.gfxAtomics ?? []).find(
        (r) => r.tribe === tribe && r.job === ADULT_ANIMAL_JOB && r.bodySeq === undefined,
      );
      const bobIds = loop?.dirFrames[0] ?? [];
      expect(bobIds.length, `tribe ${tribe} has no sequence-less adult loop`).toBeGreaterThan(0);
      const drawable = drawableBobIds(`${look.bodyStem}.${look.palette}`);
      expect(drawable, `tribe ${tribe} atlas is not served`).not.toBeNull();
      expect(bobIds.filter((id) => drawable?.has(id) !== true)).toEqual([]);
    }
  });

  it('every GfxUserFXMatrix record has its indexed effect atlas covering its frames', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const effects = (ir.landscapeGfx ?? []).filter((r) => r.userFxMatrix === true);
    expect(effects.map((r) => r.editName).sort()).toEqual(['fx wave', 'fx wave land', 'fx wave slow']);
    for (const record of effects) {
      const bmd = record.bmd ?? '';
      const drawable = drawableBobIds(
        `${bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.indexed`,
      );
      expect(drawable, `${record.editName} effect atlas is not served`).not.toBeNull();
      const bobIds = (record.frames ?? []).flatMap((list) => list.bobIds);
      expect(bobIds.filter((id) => drawable?.has(id) !== true)).toEqual([]);
    }
  });
});
