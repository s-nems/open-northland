import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir.js';
import { shadowStemsByAtlasStem } from '../src/content/sprite-sheet/human-sheet.js';

/**
 * The body-atlas-stem → shadow-atlas-stem join every real-content layer load attaches its cast-shadow
 * twin through. Pins the two properties the render side relies on: the join covers both IR lanes
 * (landscape + building rows), and a shadow-less row can never block another row's twin.
 */

const B = 'data/engine2d/bin/bobs';

describe('shadowStemsByAtlasStem — the body-stem → shadow-stem join', () => {
  it('joins landscape and building rows onto served stems, first defined stem wins', () => {
    const ir: ContentIr = {
      landscapeGfx: [
        // A shadow-less row for the SAME atlas first — it must not block the twin below.
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
