import { parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractAtomicAnimations,
  extractGoods,
  extractGraphicsBindings,
  extractJobs,
  extractLandscape,
  extractPaletteIndex,
  extractTribes,
  parseIniSections,
} from '../src/decoders/ini.js';

/**
 * Rule parser tests. No copyrighted fixtures are committed: the `.ini` snippets below are synthetic
 * but mirror the real grammar of `Data/logic/goodtypes.ini` and `landscapetypes.ini` (quoted names,
 * multi-value lines, repeated keys, the `<CULTURES_CIF_BEGIN>` header).
 */

const GOODTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000247> Don't modify this line!
[goodtype]
name "water"
type 1
landscapetype 3
isInputGoodFlag 1

[goodtype]
name "wood"
type 5
landscapetype 7
atomicForHarvesting 24

[goodtype]
name "wheat"
type 4
atomicForHarvesting 29
atomicForCultivating 35
atomicForPlanting 34
`;

// Mirrors Data/logic/jobtypes.ini: repeated `allowatomic`, a single `baseatomics`, and a
// `forbidatomic` deny line. The second job carries a `&`/space name to exercise slugging.
const JOBTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><0000027A> Don't modify this line!
[jobtype]
type 3
name "child_female"
baseatomics 1
allowatomic 8
allowatomic 15
forbidatomic 99
canBeTrainedFlag 0
[jobtype]
type 30
name "herb & mush guy"
allowatomic 8
`;

// Mirrors DataCnmd/tribetypes12/tribetypes.ini: `setatomic <job> <atomic> "anim"`, incl. a line
// with a trailing `//`-comment (the real file has these on a few ship atomics).
const TRIBETYPES_INI = `[tribetype]
type 1
name "viking"
setatomic 1 8 "viking_baby_female_sleep"
setatomic 5 22 "viking_woman_pickup"
setatomic 52 84 "viking_ship_small_idle_short_a" // "viking_ship_small_dock"
setatomic 5 22 "viking_woman_pickup_alt"
`;

// Mirrors DataCnmd/atomicanimations12/atomicanimations.ini: `[atomicanimation]` records with a
// quoted `name`, scalar `length`/`interruptable`/`startdirection`, and timed `event`/`eventx` lines
// (3-field = no value, 4-field = signed value). The first record exercises every field; the others
// exercise defaults (no length/interruptable) and the eat-yield shape.
const ATOMICANIMATIONS_INI = `[atomicanimation]
name "viking_woman_pickup"
length 20
interruptable 1
startdirection 6
event 16 11 0
eventx 18 22 -100
event 19 13

[atomicanimation]
name "viking_child_female_eat_slot_food"
length 50
event 30 2 +4000

[atomicanimation]
name "viking_man_idle"
`;

const LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><000002BF> Don't modify this line!
[landscapetype]
type 4
name "tree"
allowedonland 1
maximumValency 5
transition 7 4 2 1 0
transition 11 5 2 0 0
debugcolor 2 115 0
[landscapetype]
type 5
name "tree falling"
allowedonland 1
maximumValency 5
`;

describe('decodeIni (CP1250 byte->text seam)', () => {
  it('decodes 0x80..0xFF bytes as CP1250 Polish glyphs, not UTF-8', () => {
    // "Północ" (mod campaign theme) from its exact CP1250 bytes: 'ó' is 0xF3, 'ł' is 0xB3.
    const polnoc = Uint8Array.from([0x50, 0xf3, 0xb3, 0x6e, 0x6f, 0x63]); // P ó ł n o c
    expect(decodeIni(polnoc)).toBe('Północ');
    // The same bytes read as UTF-8 mangle the high bytes into replacement chars — the bug we avoid.
    expect(new TextDecoder('utf-8').decode(polnoc)).not.toBe('Północ');
  });

  it('leaves ASCII structure (header, [section], keys) byte-identical', () => {
    const text = '<CULTURES_CIF_BEGIN>\n[goodtype]\nname "wood"\ntype 5\n';
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(decodeIni(bytes)).toBe(text);
  });

  it('feeds the parser so a CP1250 display name reaches the section unmangled', () => {
    // 'ś' is 0x9C, 'ą' is 0xB9 in Windows-1250 — exactly the bytes a UTF-8 read would corrupt.
    const bytes = Uint8Array.from([
      0x5b,
      0x74,
      0x5d,
      0x0a, // "[t]\n"
      0x6e,
      0x61,
      0x6d,
      0x65,
      0x20,
      0x22, // 'name "'
      0x9c,
      0xb9, // 'ś', 'ą'
      0x22,
      0x0a, // '"\n'
    ]);
    const [sec] = parseIniSections(decodeIni(bytes));
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['śą']);
  });
});

describe('parseIniSections', () => {
  it('parses sections, skips the CIF header/blank lines, keeps multi-value + repeated keys', () => {
    const sections = parseIniSections(LANDSCAPE_INI);
    expect(sections.map((s) => s.name)).toEqual(['landscapetype', 'landscapetype']);

    const tree = sections[0];
    expect(tree?.name).toBe('landscapetype');
    // quoted value -> single token; signed/multi values preserved as raw strings.
    expect(tree?.props.find((p) => p.key === 'name')?.values).toEqual(['tree']);
    expect(tree?.props.find((p) => p.key === 'debugcolor')?.values).toEqual(['2', '115', '0']);
    // repeated `transition` keys are both retained in file order.
    expect(tree?.props.filter((p) => p.key === 'transition')).toHaveLength(2);
  });

  it('treats a quoted value with spaces as one token', () => {
    const [sec] = parseIniSections('[t]\nname "tree falling"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['tree falling']);
  });

  it('strips `//` inline and full-line comments (the marker real .ini files use)', () => {
    // landscapetypes.ini has lines like: `transition 3 80 2 -1 9 // transition 3 80 2 -1 9`
    const sections = parseIniSections('[t]\n// a full-line comment\ntransition 3 80 2 -1 9 // dup\n');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.props).toEqual([{ key: 'transition', values: ['3', '80', '2', '-1', '9'] }]);
  });

  it('keeps a `//` that lives inside a quoted value', () => {
    const [sec] = parseIniSections('[t]\nname "a // b"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['a // b']);
  });
});

describe('cifLinesToSections (unification with .cif)', () => {
  it('produces the same RuleSection shape from level-tagged lines as .ini does', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'landscapetype' },
      { level: 2, text: 'type 4' },
      { level: 2, text: 'name "tree"' },
      { level: 2, text: 'debugcolor 2 115 0' },
    ];
    const fromCif = cifLinesToSections(lines);
    const fromIni = parseIniSections('[landscapetype]\ntype 4\nname "tree"\ndebugcolor 2 115 0\n');
    expect(fromCif).toEqual(fromIni);
  });
});

describe('extractGoods', () => {
  it('maps [goodtype] sections to validated GoodType IR with slug ids and provenance', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), {
      file: 'Data/logic/goodtypes.ini',
    });
    const src = { file: 'Data/logic/goodtypes.ini', block: 'goodtype', layer: 'base' };
    expect(goods).toEqual([
      { typeId: 1, id: 'water', name: 'water', weight: 0, atomics: {}, source: src },
      { typeId: 5, id: 'wood', name: 'wood', weight: 0, atomics: { harvest: 24 }, source: src },
      {
        typeId: 4,
        id: 'wheat',
        name: 'wheat',
        weight: 0,
        atomics: { harvest: 29, cultivate: 35, plant: 34 },
        source: src,
      },
    ]);
  });

  it('throws on a [goodtype] missing its numeric `type`', () => {
    expect(() => extractGoods(parseIniSections('[goodtype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });
});

describe('extractJobs', () => {
  it('collects repeated allow/base/forbid atomic lines into ordered arrays', () => {
    const jobs = extractJobs(parseIniSections(JOBTYPES_INI), { file: 'Data/logic/jobtypes.ini' });
    const src = { file: 'Data/logic/jobtypes.ini', block: 'jobtype', layer: 'base' };
    expect(jobs).toEqual([
      {
        typeId: 3,
        id: 'child_female',
        name: 'child_female',
        allowedAtomics: [8, 15],
        baseAtomics: [1],
        forbiddenAtomics: [99],
        source: src,
      },
      // `&` and spaces slug to single underscores, matching extractLandscape's slug rules.
      {
        typeId: 30,
        id: 'herb_mush_guy',
        name: 'herb & mush guy',
        allowedAtomics: [8],
        baseAtomics: [],
        forbiddenAtomics: [],
        source: src,
      },
    ]);
  });

  it('defaults atomic lists to empty when a job grants none', () => {
    const [job] = extractJobs(parseIniSections('[jobtype]\ntype 2\nname "baby_male"\n'), {
      file: 'f.ini',
    });
    expect(job).toMatchObject({ allowedAtomics: [], baseAtomics: [], forbiddenAtomics: [] });
  });
});

describe('extractTribes', () => {
  it('maps `setatomic` triples to (jobType, atomicId, animation) bindings in file order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    expect(tribes).toHaveLength(1);
    expect(tribes[0]).toMatchObject({ typeId: 1, id: 'viking', name: 'viking' });
    // The `//`-comment on the third line is stripped by the parser, so the animation token is clean.
    // A repeated (jobType, atomicId) pair is kept in file order — consumers resolve last-wins.
    expect(tribes[0]?.atomicBindings).toEqual([
      { jobType: 1, atomicId: 8, animation: 'viking_baby_female_sleep' },
      { jobType: 5, atomicId: 22, animation: 'viking_woman_pickup' },
      { jobType: 52, atomicId: 84, animation: 'viking_ship_small_idle_short_a' },
      { jobType: 5, atomicId: 22, animation: 'viking_woman_pickup_alt' },
    ]);
  });
});

describe('extractAtomicAnimations', () => {
  it('captures length/interruptable/startdirection scalars and ordered event/eventx tuples', () => {
    const anims = extractAtomicAnimations(parseIniSections(ATOMICANIMATIONS_INI), {
      file: 'DataCnmd/atomicanimations12/atomicanimations.ini',
      layer: 'mod',
    });
    const src = {
      file: 'DataCnmd/atomicanimations12/atomicanimations.ini',
      block: 'atomicanimation',
      layer: 'mod',
    };
    expect(anims).toEqual([
      {
        id: 'viking_woman_pickup',
        name: 'viking_woman_pickup',
        length: 20,
        interruptible: true,
        startDirection: 6,
        events: [
          // `event 16 11 0` -> value 0 kept (distinct from a missing value).
          { at: 16, type: 11, value: 0, extended: false },
          // `eventx` becomes an extended event; signed value preserved.
          { at: 18, type: 22, value: -100, extended: true },
          // `event 19 13` has no value field -> `value` omitted entirely.
          { at: 19, type: 13, extended: false },
        ],
        source: src,
      },
      {
        id: 'viking_child_female_eat_slot_food',
        name: 'viking_child_female_eat_slot_food',
        length: 50,
        interruptible: false,
        events: [{ at: 30, type: 2, value: 4000, extended: false }],
        source: src,
      },
      // No length/interruptable lines -> schema defaults (length 0, not interruptible, no events).
      {
        id: 'viking_man_idle',
        name: 'viking_man_idle',
        length: 0,
        interruptible: false,
        events: [],
        source: src,
      },
    ]);
  });

  it('treats `interruptable 0` and a missing interruptable line both as not interruptible', () => {
    const [off] = extractAtomicAnimations(
      parseIniSections('[atomicanimation]\nname "a"\ninterruptable 0\n'),
      { file: 'f.ini' },
    );
    expect(off?.interruptible).toBe(false);
  });

  it('skips a malformed event line (non-numeric at/type) but keeps valid ones in file order', () => {
    const [anim] = extractAtomicAnimations(
      parseIniSections('[atomicanimation]\nname "a"\nevent 10 5 +200\nevent bad 9\nevent 20 6\n'),
      { file: 'f.ini' },
    );
    expect(anim?.events).toEqual([
      { at: 10, type: 5, value: 200, extended: false },
      { at: 20, type: 6, extended: false },
    ]);
  });

  it('throws on an [atomicanimation] with no (or empty) `name` — it would be unreferenceable', () => {
    expect(() =>
      extractAtomicAnimations(parseIniSections('[atomicanimation]\nlength 20\n'), { file: 'f.ini' }),
    ).toThrow(/without a `name`/);
    // An empty/whitespace name is just as unreferenceable as a missing one.
    expect(() =>
      extractAtomicAnimations(parseIniSections('[atomicanimation]\nname ""\n'), { file: 'f.ini' }),
    ).toThrow(/without a `name`/);
  });
});

describe('extractLandscape', () => {
  it('slugifies multi-word names and defaults walkable/buildable', () => {
    const land = extractLandscape(parseIniSections(LANDSCAPE_INI), {
      file: 'Data/logic/landscapetypes.ini',
      layer: 'base',
    });
    expect(land.map((l) => l.id)).toEqual(['tree', 'tree_falling']);
    expect(land[1]).toMatchObject({ typeId: 5, id: 'tree_falling', walkable: true, buildable: true });
  });
});

// Mirrors the real Data/engine2d/inis/palettes/palettes.ini grammar: [GfxPalette256] records with one
// gfxfile and one-or-more editname aliases, Windows backslash paths, the CIF header/footer marker lines.
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

describe('IR integration', () => {
  it('extracted goods + jobs + tribes + landscape + animations assemble into a valid ContentSet', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    const landscape = extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' });
    const atomicAnimations = extractAtomicAnimations(parseIniSections(ATOMICANIMATIONS_INI), {
      file: 'atomicanimations.ini',
      layer: 'mod',
    });
    // The tribe binds jobTypes 1/5/52, so the job set must define them (cross-ref resolvability).
    const jobs = [
      ...extractJobs(parseIniSections(JOBTYPES_INI), { file: 'jobtypes.ini' }),
      { typeId: 1, id: 'job_1' },
      { typeId: 5, id: 'job_5' },
      { typeId: 52, id: 'job_52' },
    ];
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs,
        buildings: [],
        landscape,
        tribes,
        atomicAnimations,
      }),
    ).not.toThrow();
  });

  it('rejects a tribe whose setatomic binds an unknown jobType (cross-reference)', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [], // no jobs defined -> the tribe's jobType bindings dangle
        buildings: [],
        tribes,
      }),
    ).toThrow(/unknown jobType/);
  });
});
