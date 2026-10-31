import { describe, expect, it } from 'vitest';
import { JOB_SOLDIER_SWORD } from '../../../src/catalog/jobs.js';
import { WONDERS } from '../../../src/catalog/wonders.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { humanPaletteBook } from '../../../src/content/sprite-sheet/human-palettes.js';
import { knowledgeFilm } from '../../../src/hud/knowledge/film.js';
import { buildingPicture } from '../../../src/hud/knowledge/picture.js';
import { hasRealIr, rawIrUnderTest, servedAtlasManifest } from '../helpers.js';

const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const SARACEN = 4;
const EGYPT = 7;

describe.runIf(hasRealIr())('Knowledge pictures over the decoded content', () => {
  it('films a soldier of every civilization from sheets the pack serves', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const book = humanPaletteBook(ir);
    for (const tribe of [VIKING, FRANK, BYZANTINE, SARACEN, EGYPT]) {
      for (const action of ['attack', 'walk'] as const) {
        const film = knowledgeFilm(ir, book, { kind: 'job', jobType: JOB_SOLDIER_SWORD, tribe, action });
        expect(film?.layers.length).toBeGreaterThan(0);
        for (const layer of film?.layers ?? []) {
          expect(layer.stems.some((stem) => servedAtlasManifest(stem)?.palette !== undefined)).toBe(true);
        }
      }
    }
  });

  it('draws every wonder finished', () => {
    const ir = rawIrUnderTest() as ContentIr;
    for (const wonder of WONDERS) expect(buildingPicture(ir, wonder.typeId, VIKING)).not.toBeNull();
  });
});
