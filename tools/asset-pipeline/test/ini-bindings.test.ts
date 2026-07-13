import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  extractBobSequences,
  extractGfxAnimAtomics,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractLandscapeGraphics,
  extractPaletteIndex,
  parseIniSections,
} from '../src/decoders/ini.js';

const PALETTES_INI = `<CULTURES_CIF_BEGIN><03FD><00000351> Don't modify this line!
[GfxPalette256]
editname "tree01"
gfxfile "data\\Engine2D\\Bin\\palettes\\landscapes\\tree01.pcx"
gfxpreshade 1
[GfxPalette256]
editname "bear01"
editname "deer01"
gfxfile "data\\engine2d\\bin\\palettes\\creatures\\bear01.pcx"
gfxpreshade 1
[GfxPalette256]
editname "nopcx_skipme"
gfxpreshade 1
<CULTURES_CIF_END> Don't modify this line!`;

describe('extractPaletteIndex', () => {
  it('flattens aliases to one normalized .pcx path each and skips records without a gfxfile', () => {
    const aliases = extractPaletteIndex(parseIniSections(PALETTES_INI));
    // Two records contribute (1 + 2 aliases); the gfxfile-less record is dropped.
    expect(aliases).toEqual([
      { name: 'tree01', gfxFile: 'data/engine2d/bin/palettes/landscapes/tree01.pcx' },
      { name: 'bear01', gfxFile: 'data/engine2d/bin/palettes/creatures/bear01.pcx' },
      { name: 'deer01', gfxFile: 'data/engine2d/bin/palettes/creatures/bear01.pcx' },
    ]);
  });

  it('builds a name -> .pcx lookup map where aliases share a file', () => {
    const map = new Map(extractPaletteIndex(parseIniSections(PALETTES_INI)).map((a) => [a.name, a.gfxFile]));
    expect(map.get('bear01')).toBe(map.get('deer01'));
    expect(map.has('nopcx_skipme')).toBe(false);
  });
});

// Mirrors the real Data/engine2d/inis/animals/jobgraphics.ini grammar: [jobgraphics] records with a
// gfxbobmanagerbody (body .bmd + optional shadow .bmd), a gfxpalettebody editname, and logictribe/
// logicjob cross-reference ids. The last two records exercise the skip paths (no body / no palette).
const JOBGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobgraphics]
logictribe 21
logicjob 48
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_Ani_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Ani_Body_00_s.bmd"
gfxpalettebody "BEAR01"
[jobgraphics]
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_NoShadow.bmd"
gfxpalettebody "deer01"
[jobgraphics]
logictribe 9
gfxpalettebody "orphan_no_body"
[jobgraphics]
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_NoPalette.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_NoPalette_s.bmd"
`;

describe('extractGraphicsBindings', () => {
  it('binds each [jobgraphics] body .bmd to its palette editname, normalizing paths + lower-casing the name', () => {
    const bindings = extractGraphicsBindings(parseIniSections(JOBGRAPHICS_INI));
    // Records 3 (no body) and 4 (no palette) are dropped; the first two bind. The first record's
    // `BEAR01` is lower-cased to `bear01` — the join key is case-insensitive (real data mixes case).
    expect(bindings).toEqual([
      {
        bmd: 'data/engine2d/bin/bobs/cr_ani_body_00.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/cr_ani_body_00_s.bmd',
        paletteName: 'bear01',
        tribeId: 21,
        jobId: 48,
      },
      {
        bmd: 'data/engine2d/bin/bobs/cr_noshadow.bmd',
        shadowBmd: undefined,
        paletteName: 'deer01',
        tribeId: undefined,
        jobId: undefined,
      },
    ]);
  });

  it('resolves a bound .bmd to a .pcx palette across a case mismatch (BEAR01 -> bear01)', () => {
    // The binding references `BEAR01`; palettes.ini declares `bear01` — the lower-cased join must still
    // hit. This mirrors the real chicken01/Chicken01 + LION01/Lion01 case splits between the two legs.
    const palettes = new Map(
      extractPaletteIndex(parseIniSections(PALETTES_INI)).map((a) => [a.name, a.gfxFile]),
    );
    const [first] = extractGraphicsBindings(parseIniSections(JOBGRAPHICS_INI));
    expect(palettes.get(first?.paletteName ?? '')).toBe('data/engine2d/bin/palettes/creatures/bear01.pcx');
  });
});

describe('extractLandscapeGraphics', () => {
  // Mirrors the real Data/engine2d/inis/landscapes/landscapes.cif [GfxLandscape] grammar as
  // cifLinesToSections yields it: a level-1 CamelCase section header, level-2 CamelCase props. Two tree
  // species share the ls_trees body bob but bind different palettes (Tree_Yew01 vs tree01 — case mixed
  // like the real data); a third decor record is texture-only (no GfxBobLibs) and must be skipped.
  const lines: CifLine[] = [
    { level: 1, text: 'GfxLandscape' },
    { level: 2, text: 'EditName "yew 01"' },
    {
      level: 2,
      text: 'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_trees.bmd" "data\\engine2d\\bin\\bobs\\ls_trees_s.bmd"',
    },
    { level: 2, text: 'GfxPalette "Tree_Yew01"' },
    { level: 2, text: 'GfxFrames 3 60 60 60 61' },
    { level: 1, text: 'GfxLandscape' },
    { level: 2, text: 'EditName "fir 01"' },
    { level: 2, text: 'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_trees.bmd"' },
    { level: 2, text: 'GfxPalette "tree01"' },
    { level: 1, text: 'GfxLandscape' }, // texture-only marker: no GfxBobLibs -> dropped
    { level: 2, text: 'EditName "border"' },
    { level: 2, text: 'GfxPalette "tree01"' },
  ];

  it('binds each [GfxLandscape] body bob to its palette, normalizing path + lower-casing the name, carrying EditName', () => {
    expect(extractLandscapeGraphics(cifLinesToSections(lines))).toEqual([
      {
        bmd: 'data/engine2d/bin/bobs/ls_trees.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/ls_trees_s.bmd',
        paletteName: 'tree_yew01',
        tribeId: undefined,
        jobId: undefined,
        editName: 'yew 01',
      },
      {
        bmd: 'data/engine2d/bin/bobs/ls_trees.bmd',
        shadowBmd: undefined,
        paletteName: 'tree01',
        tribeId: undefined,
        jobId: undefined,
        editName: 'fir 01',
      },
    ]);
  });

  it('skips a record with no body bob (texture-only decor) and one with no palette', () => {
    const noPalette: CifLine[] = [
      { level: 1, text: 'GfxLandscape' },
      { level: 2, text: 'EditName "unbindable"' },
      { level: 2, text: 'GfxBobLibs "data\\engine2d\\bin\\bobs\\ls_trees.bmd"' },
    ];
    expect(extractLandscapeGraphics(cifLinesToSections(noPalette))).toEqual([]);
  });
});

describe('extractBobSequences', () => {
  // Mirrors the real animations.ini [bobseq] grammar: an imagelib + shadowlib then `seq "<name>" <start>
  // <length>` lines (the exact walk/chop ranges the renderer hard-codes today — walk 1988/96, chop
  // 5106/120). A second record reuses one sequence name in a different bob set (a shared layout), and a
  // record with no imagelib (nothing to index) must be dropped. A malformed seq line (missing length) is
  // skipped without dropping the rest of the record.
  const src = { file: 'animations.ini', layer: 'mod' as const };
  const sections = parseIniSections(
    [
      '[bobseq]',
      'imagelib "CR_Hum_Body_00.bmd"',
      'shadowlib "CR_Hum_Body_00_S.bmd"',
      'seq "human_man_generic_walk" 1988 96',
      'seq "human_man_woodcutter_work_woodcutting" 5106 120',
      'seq "broken" 42', // missing length -> skipped, rest of record kept
      '[bobseq]',
      'imagelib "CR_Hum_Body_05.bmd"',
      'seq "human_man_generic_walk" 1988 96',
      '[bobseq]', // no imagelib -> dropped
      'seq "orphan" 1 8',
    ].join('\n'),
  );

  it('extracts one set per [bobseq], normalizing the .bmd names and parsing each seq start/length', () => {
    expect(extractBobSequences(sections, src)).toEqual([
      {
        imagelib: 'cr_hum_body_00.bmd',
        shadowlib: 'cr_hum_body_00_s.bmd',
        sequences: [
          { name: 'human_man_generic_walk', start: 1988, length: 96 },
          { name: 'human_man_woodcutter_work_woodcutting', start: 5106, length: 120 },
        ],
        source: { file: 'animations.ini', block: 'bobseq', layer: 'mod' },
      },
      {
        imagelib: 'cr_hum_body_05.bmd',
        sequences: [{ name: 'human_man_generic_walk', start: 1988, length: 96 }],
        source: { file: 'animations.ini', block: 'bobseq', layer: 'mod' },
      },
    ]);
  });
});

describe('extractGfxAnimAtomics', () => {
  // Mirrors the real mapmoveableanimations/animations.ini [gfxanimatomic] grammar: a (tribe, job, action)
  // → body bobseq with EITHER per-direction frame lists (`gfxanimframelistdir <dir> <idx…>`, placed at
  // its dir slot) OR one non-directional `gfxanimframelist` list. A record's frame indices are LOCAL to
  // the bobseq pool and author holds inline (frame 79 repeated). A record missing its tribe/job/action or
  // carrying no frame list is dropped.
  const src = { file: 'animations.ini', layer: 'mod' as const };
  const sections = parseIniSections(
    [
      '[gfxanimatomic]',
      'logictribe 1',
      'logicjob 33',
      'logicatomicaction 81',
      'gfxbobseqbody "human_man_Warrior_spear_attack"',
      // Out of dir order + a hold (79 repeated) — placed at the correct dir slot regardless of file order.
      'gfxanimframelistdir 1 97 97 98',
      'gfxanimframelistdir 0 79 79 80',
      '[gfxanimatomic]',
      'logictribe 1',
      'logicjob 4',
      'logicatomicaction 8',
      'gfxbobseqbody "human_child_boy_generic_sleep"',
      'gfxanimframelist 0 1 2 3 2 1', // non-directional -> one facing-locked list
      '[gfxanimatomic]', // no tribe/job/action -> dropped
      'gfxbobseqbody "orphan"',
      'gfxanimframelist 0 1',
      '[gfxanimatomic]', // has ids but no frame list -> dropped
      'logictribe 1',
      'logicjob 9',
      'logicatomicaction 81',
      'gfxbobseqbody "human_man_no_frames"',
    ].join('\n'),
  );

  it('places each gfxanimframelistdir at its dir slot and keeps the local indices (holds included)', () => {
    expect(extractGfxAnimAtomics(sections, src)).toEqual([
      {
        tribe: 1,
        job: 33,
        action: 81,
        bodySeq: 'human_man_Warrior_spear_attack',
        dirFrames: [
          [79, 79, 80], // dir 0 (the hold survives)
          [97, 97, 98], // dir 1
        ],
        source: { file: 'animations.ini', block: 'gfxanimatomic', layer: 'mod' },
      },
      {
        tribe: 1,
        job: 4,
        action: 8,
        bodySeq: 'human_child_boy_generic_sleep',
        dirFrames: [[0, 1, 2, 3, 2, 1]], // one facing-locked list
        source: { file: 'animations.ini', block: 'gfxanimatomic', layer: 'mod' },
      },
    ]);
  });

  it('captures the optional head bobseq when the record overlays a separate head', () => {
    const [rec] = extractGfxAnimAtomics(
      parseIniSections(
        [
          '[gfxanimatomic]',
          'logictribe 1',
          'logicjob 35',
          'logicatomicaction 81',
          'gfxbobseqbody "human_man_Warrior_Broadsword_attack"',
          'gfxbobseqhead "human_man_Warrior_Sword_Attack"',
          'gfxanimframelistdir 0 5 6 7',
        ].join('\n'),
      ),
      src,
    );
    expect(rec?.headSeq).toBe('human_man_Warrior_Sword_Attack');
  });
});

// Mirrors the real DataCnmd/types/humanstype/jobgraphics.ini [jobbasegraphics] grammar: an indexed
// body bob (leading int slot + body .bmd + optional shadow), numbered head bobs (slot + head .bmd, no
// shadow), and three optional palette names. Record 1 has body+heads+all palettes; record 2 is
// body-only (no heads, only a random palette, like the real grizzu bears); record 3 has no body bob
// and is skipped.
const JOBBASEGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobbasegraphics]
logictribe 1
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_00.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_01.bmd"
gfxpalettebasebody "Test_Human_00"
gfxpalettebasehead "test_human_00"
gfxpaletterandom "Vik_Man_Base"
[jobbasegraphics]
logictribe 3
logicjob 32
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_72.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_72_s.bmd"
gfxpaletterandom "grizzu"
[jobbasegraphics]
logictribe 9
gfxpalettebasebody "orphan_no_body"
`;

describe('extractJobBaseGraphics', () => {
  it('parses indexed body/head bobs (path on values[1]) + the three split palettes, lower-casing palette names', () => {
    const bindings = extractJobBaseGraphics(parseIniSections(JOBBASEGRAPHICS_INI));
    // Record 3 (no body bob) is skipped; records 1 and 2 bind.
    expect(bindings).toEqual([
      {
        tribeId: 1,
        jobId: 6,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_00_s.bmd',
          },
        ],
        head: [
          { index: 0, bmd: 'data/engine2d/bin/bobs/cr_hum_head_00.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/engine2d/bin/bobs/cr_hum_head_01.bmd', shadowBmd: undefined },
        ],
        // `Test_Human_00` lower-cases to join case-insensitively onto the palette index.
        bodyPalette: 'test_human_00',
        headPalette: 'test_human_00',
        randomPalette: 'vik_man_base',
      },
      {
        tribeId: 3,
        jobId: 32,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_72.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_72_s.bmd',
          },
        ],
        // Body-only: no head bobs, only a random-tint palette (like the real grizzu bears).
        head: [],
        bodyPalette: undefined,
        headPalette: undefined,
        randomPalette: 'grizzu',
      },
    ]);
  });

  it('resolves a body palette across a case mismatch via the shared palettes index', () => {
    // The flat [jobgraphics] extractor stays untouched by the [jobbasegraphics] sections — the two
    // skins coexist in one file in the real mod, each guarding on its own section name.
    expect(extractGraphicsBindings(parseIniSections(JOBBASEGRAPHICS_INI))).toEqual([]);
    expect(extractJobBaseGraphics(parseIniSections(JOBGRAPHICS_INI))).toEqual([]);
  });
});

// Mirrors the real [jobbasegraphics]/[jobchangegraphics] coexistence in one file: a base-appearance
// record (job 6) and an equipment-skin record (job 27, swapping in a different head bob set over the
// shared body) using the *same* grammar, differing only in section name.
const JOBCHANGEGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobbasegraphics]
logictribe 1
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_00.bmd"
gfxpaletterandom "Vik_Man_Base"
[jobchangegraphics]
logictribe 1
logicjob 27
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_80.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_81.bmd"
gfxpalettebasehead "Test_Human_00"
gfxpaletterandom "Vik_Man_ChangeJob"
`;

describe('extractJobChangeGraphics', () => {
  it('parses [jobchangegraphics] equipment-skin records with the same grammar as the base layer', () => {
    const bindings = extractJobChangeGraphics(parseIniSections(JOBCHANGEGRAPHICS_INI));
    // Only the [jobchangegraphics] record is picked up; the [jobbasegraphics] one is ignored here.
    expect(bindings).toEqual([
      {
        tribeId: 1,
        jobId: 27,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_00_s.bmd',
          },
        ],
        head: [
          { index: 0, bmd: 'data/engine2d/bin/bobs/cr_hum_head_80.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/engine2d/bin/bobs/cr_hum_head_81.bmd', shadowBmd: undefined },
        ],
        bodyPalette: undefined,
        headPalette: 'test_human_00',
        randomPalette: 'vik_man_changejob',
      },
    ]);
  });

  it('is independent of the base layer: each extractor sees only its own section name', () => {
    // The two skins coexist in one file; the base extractor must not bleed into the change records
    // and vice versa, so a file is never double-counted when both run over it.
    expect(extractJobBaseGraphics(parseIniSections(JOBCHANGEGRAPHICS_INI))).toEqual([
      expect.objectContaining({ jobId: 6 }),
    ]);
    expect(extractJobChangeGraphics(parseIniSections(JOBBASEGRAPHICS_INI))).toEqual([]);
  });
});
