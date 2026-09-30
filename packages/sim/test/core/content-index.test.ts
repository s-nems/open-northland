import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentIndex } from '../../src/core/content-index.js';
import { testContent } from '../fixtures/content.js';

describe('contentIndex identity', () => {
  it('answers each set with its own index when callers alternate between sets', () => {
    const a = testContent();
    const b = testContent();
    const indexA = contentIndex(a);
    const indexB = contentIndex(b);
    expect(indexB).not.toBe(indexA);
    expect(contentIndex(a)).toBe(indexA);
    expect(contentIndex(b)).toBe(indexB);
  });
});

describe('contentIndex command-boundary tables', () => {
  it('keeps the last content row at the command boundary while the read tables keep the first', () => {
    const base = testContent();
    const firstBuilding = base.buildings[0];
    const firstJob = base.jobs[0];
    if (firstBuilding === undefined || firstJob === undefined)
      throw new Error('fixture must contain a building and job');

    const lastBuilding = { ...firstBuilding, id: `${firstBuilding.id}_duplicate` };
    const lastJob = { ...firstJob, id: `${firstJob.id}_duplicate` };
    const content: ContentSet = {
      ...base,
      buildings: [firstBuilding, lastBuilding],
      jobs: [firstJob, lastJob],
    };

    const index = contentIndex(content);
    expect(index.buildings.get(firstBuilding.typeId)).toBe(firstBuilding);
    expect(index.jobs.get(firstJob.typeId)).toBe(firstJob);
    expect(index.commandBuildings.get(firstBuilding.typeId)).toBe(lastBuilding);
    expect(index.commandJobs.get(firstJob.typeId)).toBe(lastJob);
  });
});

/**
 * The base-job chain feeds the permission gate and the gatherer classification alike: a trade that
 * grants nothing of its own still counts as a gatherer when its base job grants a harvest atomic
 * (`jobtypes.ini` `baseatomics`, e.g. every armed soldier resolving through `soldier_unarmed`). Every
 * fixture and fallback job is a root, so nothing else in the sim suite exercises the inherited case.
 */
describe('contentIndex base-job chain', () => {
  const WOOD_HARVEST_ATOMIC = 24; // fixtures/content/economy.ts
  const BASE_JOB = 90;
  const HEIR_JOB = 91;

  const withChain = (base: ContentSet): ContentSet => ({
    ...base,
    jobs: [
      ...base.jobs,
      { typeId: BASE_JOB, id: 'feller', allowedAtomics: [WOOD_HARVEST_ATOMIC], forbiddenAtomics: [] },
      { typeId: HEIR_JOB, id: 'feller_sea', allowedAtomics: [], forbiddenAtomics: [], baseJob: BASE_JOB },
    ],
  });

  it('grants an heir job its base job atomics and counts it as a gatherer', () => {
    const index = contentIndex(withChain(testContent()));
    expect(index.atomicsByJob.get(HEIR_JOB)).toEqual(new Set([WOOD_HARVEST_ATOMIC]));
    expect(index.harvestJobs.has(HEIR_JOB)).toBe(true);
  });

  it('withholds an atomic the heir forbids, so it is no longer a gatherer', () => {
    const base = withChain(testContent());
    const index = contentIndex({
      ...base,
      jobs: base.jobs.map((j) =>
        j.typeId === HEIR_JOB ? { ...j, forbiddenAtomics: [WOOD_HARVEST_ATOMIC] } : j,
      ),
    });
    expect(index.atomicsByJob.get(HEIR_JOB)?.size).toBe(0);
    expect(index.harvestJobs.has(HEIR_JOB)).toBe(false);
  });
});

describe('contentIndex class weapons', () => {
  const VIKING = 1;
  const CIVILIAN = 6;
  const HUNTER = 15;
  const HOUSE_BOW = 20;
  const HUNTER_BOW = 19;

  it('never arms a civilian with the wall bow its weapons.ini row names the civilian job on', () => {
    const content = parseContentSet({
      ...testContent(),
      weapons: [
        {
          typeId: HOUSE_BOW,
          id: 'house_bow',
          tribeType: VIKING,
          jobType: CIVILIAN,
          munitionType: 1,
          speed: 7,
        },
        {
          typeId: HUNTER_BOW,
          id: 'hunter_bow',
          tribeType: VIKING,
          jobType: HUNTER,
          munitionType: 1,
          speed: 7,
        },
      ],
    });
    const index = contentIndex(content);
    expect(index.weaponsByTribeAndJob.get(VIKING)?.get(CIVILIAN)).toBeUndefined();
    expect(index.weaponsByTribeAndJob.get(VIKING)?.get(HUNTER)?.id).toBe('hunter_bow');
    expect(index.houseBowByTribe.get(VIKING)?.id).toBe('house_bow');
  });
});

describe('contentIndex harvest atomics', () => {
  it('keeps key order and the last defined harvest, including atomic zero', () => {
    const base = testContent();
    const good = base.goods[0];
    if (good === undefined) throw new Error('fixture needs a good');
    const content: ContentSet = {
      ...base,
      goods: [
        { ...good, typeId: 12, atomics: { harvest: 8 } },
        { ...good, typeId: 7, atomics: { harvest: 5 } },
        { ...good, typeId: 12, atomics: { harvest: 0 } },
        { ...good, typeId: 7, atomics: {} },
        { ...good, typeId: 99, atomics: {} },
      ],
    };
    expect([...contentIndex(content).harvestAtomicByGood]).toEqual([
      [12, 0],
      [7, 5],
    ]);
    const other: ContentSet = { ...content, goods: [{ ...good, typeId: 12, atomics: { harvest: 3 } }] };
    expect([...contentIndex(other).harvestAtomicByGood]).toEqual([[12, 3]]);
    expect([...contentIndex(content).harvestAtomicByGood]).toEqual([
      [12, 0],
      [7, 5],
    ]);
  });
});
