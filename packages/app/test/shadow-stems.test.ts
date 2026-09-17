import { describe, expect, it } from 'vitest';
import { JOB_CIVILIST, JOB_WOMAN } from '../src/catalog/jobs.js';
import { shadowStemsByAtlasStem } from '../src/content/ir/joins.js';
import type { ContentIr } from '../src/content/ir/rows.js';
import { resolveLooks } from '../src/content/sprite-sheet/character-looks.js';

/**
 * How a loaded layer finds its cast-shadow twin: object and building atlases join by served stem, while
 * a character look carries its own twin stem, since its body loads under a palette no record names.
 * Pins that a shadow-less row can never block another row's twin, and that the look's twin survives the
 * recolourable-atlas override.
 */

const B = 'data/engine2d/bin/bobs';

describe('shadowStemsByAtlasStem - the body-stem → shadow-stem join', () => {
  it('joins landscape and building rows onto served stems, first defined stem wins', () => {
    const ir: ContentIr = {
      landscapeGfx: [
        // A shadow-less row for the SAME atlas first - it must not block the twin below.
        { index: 0, logicType: 4, bmd: `${B}/ls_trees.bmd`, paletteName: 'tree_yew01' },
        {
          index: 1,
          logicType: 4,
          bmd: `${B}/ls_trees.bmd`,
          paletteName: 'tree_yew01',
          shadowBmd: `${B}/ls_trees_s.bmd`,
        },
      ],
      buildingBobs: [
        {
          tribeId: 1,
          typeId: 13,
          level: 0,
          bobId: 70,
          bmd: `${B}/ls_houses_viking.bmd`,
          paletteName: 'house01',
          shadowBmd: `${B}/ls_houses_viking_s.bmd`,
        },
      ],
    };
    const stems = shadowStemsByAtlasStem(ir);
    expect(stems.get('ls_trees.tree_yew01')).toBe('ls_trees_s.shadow');
    expect(stems.get('ls_houses_viking.house01')).toBe('ls_houses_viking_s.shadow');
    expect(stems.size).toBe(2);
  });

  it('is empty for an absent IR (a bare checkout loads shadow-less)', () => {
    expect(shadowStemsByAtlasStem(null).size).toBe(0);
  });
});

describe('resolveLooks - a character look carries its own shadow set', () => {
  const ir: ContentIr = {
    jobGraphics: [
      {
        tribe: 1,
        job: JOB_CIVILIST,
        body: `${B}/cr_hum_body_00.bmd`,
        shadowBody: `${B}/cr_hum_body_00_s.bmd`,
        heads: [`${B}/cr_hum_head_00.bmd`],
        bodyPalette: 'test_human_00',
        headPalette: 'test_human_00',
      },
      // The record the woman look ends on names no shadow set, so she keeps drawing shadow-less.
      { tribe: 1, job: JOB_WOMAN, body: `${B}/cr_hum_body_10.bmd`, heads: [] },
    ],
  };

  it('keeps the palette-less twin while the body loads as the recolourable indexed atlas', () => {
    const indexed = resolveLooks(ir, [1], 'indexed').get(1)?.get('civilian')?.[0];
    expect(indexed?.bodyStem).toBe('cr_hum_body_00.indexed');
    expect(indexed?.shadowStem).toBe('cr_hum_body_00_s.shadow');
    // The baked-skin fallback path resolves the same twin.
    const baked = resolveLooks(ir, [1], undefined).get(1)?.get('civilian')?.[0];
    expect(baked?.bodyStem).toBe('cr_hum_body_00.test_human_00');
    expect(baked?.shadowStem).toBe('cr_hum_body_00_s.shadow');
  });

  it('leaves a record naming no shadow set without one', () => {
    expect(resolveLooks(ir, [1], 'indexed').get(1)?.get('woman')?.[0]?.shadowStem).toBeUndefined();
  });
});
