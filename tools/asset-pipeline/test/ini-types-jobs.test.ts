import { describe, expect, it } from 'vitest';
import { extractJobExperience, extractJobs, extractTribes, parseIniSections } from '../src/decoders/ini.js';
import { JOBTYPES_INI, JOBXP_INI, TRIBETYPES_INI } from './fixtures/ini-sources.js';

describe('extractJobs', () => {
  it('attaches byte-evidenced movement exceptions only to their engine tribe ids', () => {
    const tribes = extractTribes(
      parseIniSections('[tribetype]\ntype 3\n[tribetype]\ntype 7\n[tribetype]\ntype 1\n'),
      { file: 'tribes.ini' },
    );
    expect(tribes.map((t) => t.walkStepReduction)).toEqual([
      { ticks: 2, jobType: 32 },
      { ticks: 2 },
      undefined,
    ]);
  });
  it('collects repeated allow/forbid atomic lines into ordered arrays, and baseatomics as one base job', () => {
    const jobs = extractJobs(parseIniSections(JOBTYPES_INI), { file: 'Data/logic/jobtypes.ini' });
    const src = { file: 'Data/logic/jobtypes.ini', block: 'jobtype', layer: 'base' };
    expect(jobs).toEqual([
      {
        typeId: 7,
        id: 'nestward',
        name: 'nestward',
        allowedAtomics: [12, 19],
        baseJob: 40,
        forbiddenAtomics: [88],
        needsReligion: false,
        ignoresHomeHouse: false,
        source: src,
      },
      // `&` and spaces slug to single underscores, matching extractLandscape's slug rules.
      {
        typeId: 40,
        id: 'reed_moss_picker',
        name: 'reed & moss picker',
        allowedAtomics: [12],
        baseJob: undefined,
        forbiddenAtomics: [],
        needsReligion: false,
        ignoresHomeHouse: false,
        source: src,
      },
    ]);
  });

  it('defaults atomic lists to empty and leaves a root job without a base', () => {
    const [job] = extractJobs(parseIniSections('[jobtype]\ntype 2\nname "baby_male"\n'), {
      file: 'f.ini',
    });
    expect(job).toMatchObject({ allowedAtomics: [], forbiddenAtomics: [] });
    expect(job?.baseJob).toBeUndefined();
  });
});

describe('extractJobExperience', () => {
  it('maps [humanjobexperiencetype] records to validated HumanJobExperienceType IR', () => {
    const tracks = extractJobExperience(parseIniSections(JOBXP_INI), {
      file: 'Data/logic/humanjobexperiencetypes.ini',
    });
    const src = {
      file: 'Data/logic/humanjobexperiencetypes.ini',
      block: 'humanjobexperiencetype',
      layer: 'base',
    };
    expect(tracks).toEqual([
      // A "general" track carries no `good` -> goodType omitted, baseRepeatCounter omitted.
      {
        typeId: 5,
        id: 'gatherer_basic',
        name: 'gatherer basic',
        jobType: 33,
        goodTypes: [],
        experienceFactor: 110,
        source: src,
      },
      // A good-specific track carries `good`.
      {
        typeId: 6,
        id: 'gatherer_reed',
        name: 'gatherer reed',
        jobType: 33,
        goodTypes: [22],
        experienceFactor: 260,
        source: src,
      },
      // `baserepeatcounter` is captured when present.
      {
        typeId: 47,
        id: 'tiller_grain',
        name: 'tiller grain',
        jobType: 34,
        goodTypes: [24],
        experienceFactor: 115,
        baseRepeatCounter: 3,
        source: src,
      },
      // One track can deliberately group several product variants.
      {
        typeId: 59,
        id: 'healer_potions',
        name: 'healer potions',
        jobType: 30,
        goodTypes: [44, 45],
        experienceFactor: 100,
        source: src,
      },
    ]);
  });

  it("fills the record's two good slots across repeated `good` lines, dropping the rest", () => {
    const oneLine = extractJobExperience(
      parseIniSections('[humanjobexperiencetype]\ntype 1\njob 30\ngood 44 45 46\n'),
      { file: 'f.ini' },
    );
    const perLine = extractJobExperience(
      parseIniSections('[humanjobexperiencetype]\ntype 1\njob 30\ngood 44\ngood 45\ngood 46\n'),
      { file: 'f.ini' },
    );
    expect(oneLine[0]?.goodTypes).toEqual([44, 45]);
    expect(perLine[0]?.goodTypes).toEqual([44, 45]);
  });

  it('throws on a record missing the required numeric `type`', () => {
    expect(() =>
      extractJobExperience(parseIniSections('[humanjobexperiencetype]\nname "x"\njob 8\n'), {
        file: 'f.ini',
      }),
    ).toThrow(/without a numeric `type`/);
  });

  it('throws on a record missing the required numeric `job`', () => {
    expect(() =>
      extractJobExperience(parseIniSections('[humanjobexperiencetype]\ntype 1\nname "x"\n'), {
        file: 'f.ini',
      }),
    ).toThrow(/without a numeric `job`/);
  });
});

describe('extractTribes', () => {
  it('maps `setatomic` triples to (jobType, atomicId, animation) bindings in file order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    expect(tribes).toHaveLength(1);
    expect(tribes[0]).toMatchObject({ typeId: 4, id: 'fenling', name: 'fenling' });
    // The `//`-comment on the third line is stripped by the parser, so the animation token is clean.
    // A repeated (jobType, atomicId) pair is kept in file order - consumers resolve last-wins.
    expect(tribes[0]?.atomicBindings).toEqual([
      { jobType: 50, atomicId: 61, animation: 'fen_broodling_rest' },
      { jobType: 51, atomicId: 65, animation: 'fen_forager_lift' },
      { jobType: 55, atomicId: 90, animation: 'fen_barge_drift' },
      { jobType: 51, atomicId: 65, animation: 'fen_forager_lift_b' },
    ]);
  });

  it('collects interleaved `jobEnables*` edges in exact source order, skipping a malformed line', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The real data interleaves the four kinds within a block, so edges keep verbatim file order
    // (good, house, good, job, vehicle here) - NOT regrouped by kind. The malformed
    // `jobEnablesGood notanint 22` (non-int jobType) is dropped, like a malformed setatomic line.
    expect(tribes[0]?.jobEnables).toEqual([
      { jobType: 51, kind: 'good', targetId: 22 },
      { jobType: 51, kind: 'house', targetId: 31 },
      { jobType: 50, kind: 'good', targetId: 24 },
      { jobType: 51, kind: 'job', targetId: 50 },
      { jobType: 51, kind: 'vehicle', targetId: 37 },
    ]);
  });

  it('collects `{need,train}for{job,good}` requirements with their expType list, in source order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The `need`/`train` prefix + `job`/`good` suffix decompose into the two dimensions; the optional
    // second expType (`needforjob 50 8 6 7`) is captured, a single one (`needforgood 22 12 9`) too,
    // and the synthetic "school" expType (71/54) on `train*` rides through unvalidated. The malformed
    // `needforjob notanint 8 3` (non-int targetId) is dropped, like a malformed jobEnables line.
    expect(tribes[0]?.jobRequirements).toEqual([
      { requirement: 'need', target: 'job', targetId: 50, amount: 8, experienceTypes: [6, 7] },
      { requirement: 'need', target: 'good', targetId: 22, amount: 12, experienceTypes: [9] },
      { requirement: 'train', target: 'job', targetId: 50, amount: 8, experienceTypes: [71] },
      { requirement: 'train', target: 'good', targetId: 24, amount: 6, experienceTypes: [54] },
    ]);
  });
});

it('extracts tribe permissions as repeated single-value rows', () => {
  const [tribe] = extractTribes(
    parseIniSections(`[tribetype]
type 1
allowjob 4
allowjob 7
allowhouse 2
allowgood 9
`),
    { file: 'synthetic.ini' },
  );
  expect(tribe?.permissions).toEqual({ job: [4, 7], house: [2], good: [9] });
});

it('preserves all required house discoveries across repeated rows and lists', () => {
  const [tribe] = extractTribes(
    parseIniSections(`[tribetype]
type 3
toBuildHouseNeedJob 8 4
toBuildHouseNeedJob 8 7
toBuildHouseNeedGood 8 2 9
toBuildHouseNeedGood 8 9 6
`),
    { file: 'synthetic.ini' },
  );
  expect(tribe?.technology?.houses).toEqual([{ house: 8, jobs: [4, 7], goods: [2, 9, 6] }]);
});
