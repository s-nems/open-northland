import { parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  extractGoods,
  extractJobs,
  extractLandscape,
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

describe('IR integration', () => {
  it('extracted goods + jobs + tribes + landscape assemble into a valid ContentSet', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    const landscape = extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' });
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
