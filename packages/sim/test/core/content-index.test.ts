import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentIndex } from '../../src/core/content-index.js';
import { testContent } from '../fixtures/content.js';

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
