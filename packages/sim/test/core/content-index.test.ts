import type { ContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { contentIndex } from '../../src/core/content-index.js';
import { testContent } from '../fixtures/content.js';

describe('contentIndex command-boundary tables', () => {
  it('preserves indexById last-wins semantics without changing first-wins read tables', () => {
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
