import { describe, expect, it } from 'vitest';
import { extractJobExperience, extractJobs, extractTribes, parseIniSections } from '../src/decoders/ini.js';
import { JOBTYPES_INI, JOBXP_INI, TRIBETYPES_INI } from './fixtures/ini-sources.js';

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
        typeId: 2,
        id: 'collector_general',
        name: 'collector general',
        jobType: 8,
        experienceFactor: 100,
        source: src,
      },
      // A good-specific track carries `good`.
      {
        typeId: 3,
        id: 'collector_wood',
        name: 'collector wood',
        jobType: 8,
        goodType: 5,
        experienceFactor: 250,
        source: src,
      },
      // `baserepeatcounter` is captured when present.
      {
        typeId: 46,
        id: 'farmer_wheat',
        name: 'farmer wheat',
        jobType: 18,
        goodType: 4,
        experienceFactor: 100,
        baseRepeatCounter: 2,
        source: src,
      },
    ]);
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

  it('collects interleaved `jobEnables*` edges in exact source order, skipping a malformed line', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The real data interleaves the four kinds within a block, so edges keep verbatim file order
    // (good, house, good, job, vehicle here) — NOT regrouped by kind. The malformed
    // `jobEnablesGood notanint 5` (non-int jobType) is dropped, like a malformed setatomic line.
    expect(tribes[0]?.jobEnables).toEqual([
      { jobType: 5, kind: 'good', targetId: 5 },
      { jobType: 5, kind: 'house', targetId: 2 },
      { jobType: 1, kind: 'good', targetId: 4 },
      { jobType: 5, kind: 'job', targetId: 1 },
      { jobType: 5, kind: 'vehicle', targetId: 3 },
    ]);
  });

  it('collects `{need,train}for{job,good}` requirements with their expType list, in source order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The `need`/`train` prefix + `job`/`good` suffix decompose into the two dimensions; the optional
    // second expType (`needforjob 1 10 6 7`) is captured, a single one (`needforgood 5 15 9`) too,
    // and the synthetic "school" expType (77/57) on `train*` rides through unvalidated. The malformed
    // `needforjob notanint 10 3` (non-int targetId) is dropped, like a malformed jobEnables line.
    expect(tribes[0]?.jobRequirements).toEqual([
      { requirement: 'need', target: 'job', targetId: 1, amount: 10, experienceTypes: [6, 7] },
      { requirement: 'need', target: 'good', targetId: 5, amount: 15, experienceTypes: [9] },
      { requirement: 'train', target: 'job', targetId: 1, amount: 10, experienceTypes: [77] },
      { requirement: 'train', target: 'good', targetId: 4, amount: 5, experienceTypes: [57] },
    ]);
  });
});
