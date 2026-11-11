import { describe, expect, it } from 'vitest';
import { VIKING } from '../../../src/catalog/buildings.js';
import { FRANK } from '../../../src/catalog/civilizations.js';
import { JOB_ARCHER_LONG, JOB_HERO_SWORD, JOB_HEROINE_BOW } from '../../../src/catalog/jobs.js';
import { BYZANTINE } from '../../../src/catalog/unit-variants.js';
import { heroFigures } from '../../../src/content/audio/hero-figures.js';
import type { ContentIr, JobGraphicsRow } from '../../../src/content/ir/rows.js';

const record = (tribe: number, job: number): JobGraphicsRow => ({
  tribe,
  job,
  body: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
  heads: [],
  randomPalettes: [],
});

describe('heroFigures', () => {
  it("names the hero jobs a tribe draws with its own record, but not the Frankish heroine's Santa", () => {
    const ir: ContentIr = {
      jobs: [
        { typeId: JOB_ARCHER_LONG, id: 'soldier_bow_long' },
        { typeId: JOB_HERO_SWORD, id: 'hero_sword_bjarni' },
        { typeId: JOB_HEROINE_BOW, id: 'heroine_bow_xena' },
      ],
      jobGraphics: [
        record(VIKING, JOB_ARCHER_LONG),
        record(VIKING, JOB_HERO_SWORD),
        record(BYZANTINE, JOB_HEROINE_BOW),
        record(FRANK, JOB_HEROINE_BOW),
      ],
    };
    expect(heroFigures(ir)).toEqual([
      { tribe: VIKING, job: JOB_HERO_SWORD },
      { tribe: BYZANTINE, job: JOB_HEROINE_BOW },
    ]);
  });
});
