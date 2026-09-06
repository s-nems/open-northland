import { describe, expect, it } from 'vitest';
import { extractJobBaseGraphics, parseIniSections } from '../src/decoders/ini.js';
import { jobGraphicsRows, mergeJobGraphics } from '../src/stages/ir/job-graphics.js';

// The mod's `types/humanstype/jobgraphics.ini` grammar: a viking civilist with four head looks, a
// frank soldier with two heads and a `human_special` head palette, and one record without a tribe.
const JOBGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><00000351> Don't modify this line!
[jobbasegraphics]
logictribe 1
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_00.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_01.bmd"
gfxpalettebasebody "test_human_00"
gfxpalettebasehead "test_human_00"
gfxpaletterandom "Vik_Man_Base"
[jobbasegraphics]
logictribe 2
logicjob 31
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_32.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_33.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_34.bmd"
gfxpalettebasebody "test_human_00"
gfxpalettebasehead "Human_Special"
[jobbasegraphics]
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_99.bmd"
<CULTURES_CIF_END> Don't modify this line!`;

const MOD_SRC = { file: 'DataCnmd/types/humanstype/jobgraphics.ini', layer: 'mod' } as const;

describe('jobGraphicsRows', () => {
  it('keys each record by (tribe, job) with its body, heads and lower-cased palettes', () => {
    const rows = jobGraphicsRows(extractJobBaseGraphics(parseIniSections(JOBGRAPHICS_INI)), MOD_SRC);
    expect(rows).toEqual([
      {
        tribe: 1,
        job: 6,
        body: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
        shadowBody: 'data/engine2d/bin/bobs/cr_hum_body_00_s.bmd',
        heads: ['data/engine2d/bin/bobs/cr_hum_head_00.bmd', 'data/engine2d/bin/bobs/cr_hum_head_01.bmd'],
        bodyPalette: 'test_human_00',
        headPalette: 'test_human_00',
        source: { file: MOD_SRC.file, block: 'jobbasegraphics', layer: 'mod' },
      },
      {
        tribe: 2,
        job: 31,
        body: 'data/engine2d/bin/bobs/cr_hum_body_32.bmd',
        heads: ['data/engine2d/bin/bobs/cr_hum_head_33.bmd', 'data/engine2d/bin/bobs/cr_hum_head_34.bmd'],
        bodyPalette: 'test_human_00',
        headPalette: 'human_special',
        source: { file: MOD_SRC.file, block: 'jobbasegraphics', layer: 'mod' },
      },
    ]);
  });
});

describe('mergeJobGraphics', () => {
  it("keeps the first layer's row per (tribe, job) and appends the rest", () => {
    const row = (tribe: number, job: number, body: string) => ({ tribe, job, body, heads: [] });
    const merged = mergeJobGraphics([
      [row(1, 6, 'mod_civilist'), row(2, 31, 'mod_soldier')],
      [row(1, 6, 'base_civilist'), row(1, 5, 'base_woman')],
    ]);
    expect(merged.map((r) => r.body)).toEqual(['mod_civilist', 'mod_soldier', 'base_woman']);
  });
});
