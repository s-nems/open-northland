import type { HumanJobExperienceType, TribeType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { rebindMovedJobExperience } from '../src/stages/ir/job-experience.js';

const track = (typeId: number, jobType: number, goodTypes: number[] = []): HumanJobExperienceType => ({
  typeId,
  id: `track_${typeId}`,
  jobType,
  goodTypes,
  experienceFactor: 100,
});

const tribe = (jobEnables: TribeType['jobEnables']): TribeType => ({
  typeId: 1,
  id: 'test',
  hitpoints: 0,
  atomicBindings: [],
  jobEnables,
  jobRequirements: [],
});

describe('rebindMovedJobExperience', () => {
  it('moves an orphan specialization to the one profession that now owns its good', () => {
    const tracks = [track(9, 9), track(10, 9, [31]), track(29, 13, [32])];
    const result = rebindMovedJobExperience(tracks, [
      tribe([
        { jobType: 9, kind: 'good', targetId: 31 },
        { jobType: 9, kind: 'good', targetId: 32 },
      ]),
    ]);
    expect(result.find((candidate) => candidate.typeId === 29)?.jobType).toBe(9);
  });

  it('keeps a multi-good specialization when all variants still belong to its profession', () => {
    const tracks = [track(59, 30, [44, 45])];
    const result = rebindMovedJobExperience(tracks, [
      tribe([
        { jobType: 30, kind: 'good', targetId: 44 },
        { jobType: 30, kind: 'good', targetId: 45 },
      ]),
    ]);
    expect(result).toEqual(tracks);
  });

  it('does not create a duplicate specialization at the new owner', () => {
    const tracks = [track(8, 8, [14]), track(55, 29, [14])];
    const result = rebindMovedJobExperience(tracks, [tribe([{ jobType: 8, kind: 'good', targetId: 14 }])]);
    expect(result.find((candidate) => candidate.typeId === 55)?.jobType).toBe(29);
  });
});
