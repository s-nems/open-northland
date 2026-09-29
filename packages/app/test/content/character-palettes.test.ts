import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SettlerCharacter } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { MONSTER_TRIBES } from '../../src/catalog/creatures.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
} from '../../src/catalog/jobs.js';
import { INDEXED_CHARACTER_PALETTE } from '../../src/catalog/roster.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { isAnimalBody } from '../../src/content/settler-gfx/index.js';
import {
  type ResolvedLook,
  resolveAnimalJobLooks,
  resolveLooks,
} from '../../src/content/sprite-sheet/character-looks.js';
import { characterTablesUnderTest, contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Pins which atlas each character layer loads from against the served content: a look draws through the
 * human palette LUT or in its baked skin as a whole, since a baked head drawn through the paletted shader
 * reads its colours as palette indices.
 */

const VIKING = 1;
const FRANK = 2;
const EGYPT = 7;
const INDEXED_SUFFIX = `.${INDEXED_CHARACTER_PALETTE}`;

function atlasServed(stem: string): boolean {
  return existsSync(resolve(contentDir(), 'bobs', `${stem}.atlas.json`));
}

/** Every look of every civilization that authors `[jobbasegraphics]` records, as the LUT-loaded sheet
 *  resolves it. */
function everyLook(ir: ContentIr): ResolvedLook[] {
  const tribes = [...new Set((ir.jobGraphics ?? []).map((row) => row.tribe))].filter(
    (tribe) => !MONSTER_TRIBES.has(tribe),
  );
  return [
    ...[...resolveLooks(ir, tribes, INDEXED_CHARACTER_PALETTE).values()].flatMap((bySpec) =>
      [...bySpec.values()].flat(),
    ),
    ...[...resolveAnimalJobLooks(ir, tribes).values()].flatMap((byJob) => [...byJob.values()].flat()),
  ];
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'bobs')))('character look palettes', () => {
  it('loads each look indexed or baked as one, the heads following the body', () => {
    const looks = everyLook(rawIrUnderTest() as ContentIr);
    expect(looks.length).toBeGreaterThan(0);
    for (const look of looks) {
      for (const stem of [look.bodyStem, ...look.headStems]) {
        expect(stem.endsWith(INDEXED_SUFFIX), `${look.bodyStem} layer ${stem}`).toBe(look.indexed);
      }
    }
  });

  it('keeps baked exactly the bodies the pipeline serves no recolourable atlas for', () => {
    for (const look of everyLook(rawIrUnderTest() as ContentIr)) {
      const indexedServed = atlasServed(`${look.bodyBmd}${INDEXED_SUFFIX}`);
      if (isAnimalBody(look.bodyBmd)) {
        expect(indexedServed, `${look.bodyBmd} unexpectedly has an indexed atlas`).toBe(false);
        expect(atlasServed(look.bodyStem), `${look.bodyStem} is not served`).toBe(true);
      } else if (atlasServed(`${look.bodyBmd}.${look.bodyPalette}`)) {
        expect(indexedServed, `${look.bodyBmd} is served baked but not indexed`).toBe(true);
      }
    }
  });

  it('keeps every monster look in its authored skin', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const looks = [...resolveLooks(ir, [...MONSTER_TRIBES], INDEXED_CHARACTER_PALETTE).values()].flatMap(
      (bySpec) => [...bySpec.values()].flat(),
    );
    expect(looks.length).toBeGreaterThan(0);
    for (const look of looks) {
      expect(look.indexed, look.bodyStem).toBe(false);
      for (const stem of [look.bodyStem, ...look.headStems]) {
        expect(stem.endsWith(INDEXED_SUFFIX), `${look.bodyStem} layer ${stem}`).toBe(false);
      }
    }
  });

  it('draws the frank and egyptian soldiers through the LUT, whatever skin their records name', () => {
    const tables = characterTablesUnderTest([VIKING, FRANK, EGYPT]);
    expect(tables).not.toBeNull();
    const soldiers: [number, number][] = [
      [FRANK, JOB_SOLDIER_SPEAR_WOODEN],
      [FRANK, JOB_SOLDIER_SPEAR],
      [EGYPT, JOB_SOLDIER_SPEAR_WOODEN],
      [EGYPT, JOB_ARCHER],
      [EGYPT, JOB_ARCHER_LONG],
    ];
    for (const [tribe, job] of soldiers) {
      const character: SettlerCharacter | undefined = tables?.get(tribe)?.byJob[job];
      expect(character, `tribe ${tribe} job ${job}`).toBeDefined();
      expect(character?.indexed, `tribe ${tribe} job ${job}`).not.toBe(false);
    }
  });
});
