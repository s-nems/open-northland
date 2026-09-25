import type { HumanJobExperienceType, TribeType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { correctJobExperience } from '../src/stages/ir/job-experience.js';

const CARPENTER = 9;
const ARMORER = 10;
const SMITH = 13;
const HERBALIST = 29;
const COLLECTOR = 8;
const DRUID = 30;
const MUSHROOM = 14;
const IRON_TOOL = 32;
const POTION_SMALL = 44;
const POTION_BIG = 45;

const track = (
  typeId: number,
  jobType: number,
  goodTypes: number[] = [],
  name?: string,
): HumanJobExperienceType => ({
  typeId,
  id: name?.replace(/ /g, '_') ?? `track_${typeId}`,
  ...(name === undefined ? {} : { name }),
  jobType,
  goodTypes,
  experienceFactor: 100,
  baseRepeatCounter: 10,
});

const tribe = (jobEnables: TribeType['jobEnables']): TribeType => ({
  typeId: 1,
  id: 'test',
  atomicBindings: [],
  jobEnables,
  jobRequirements: [],
});

const enables = (jobType: number, targetId: number) => ({ jobType, kind: 'good' as const, targetId });

/** The mod's real edges for the goods these cases touch. */
const CULTURESNATION_TRIBE = tribe([
  enables(CARPENTER, IRON_TOOL),
  enables(COLLECTOR, MUSHROOM),
  enables(DRUID, POTION_SMALL),
  enables(DRUID, POTION_BIG),
]);

describe('correctJobExperience', () => {
  it('re-owns a record the mod left on the profession that no longer makes its good', () => {
    const tracks = [
      track(9, CARPENTER, [], 'carpenter general'),
      track(29, SMITH, [IRON_TOOL], 'smith iron tool'),
    ];
    const [, corrected] = correctJobExperience(tracks, [CULTURESNATION_TRIBE]);
    expect(corrected).toMatchObject({
      typeId: 29,
      id: 'carpenter_iron_tool',
      name: 'carpenter iron tool',
      jobType: CARPENTER,
      goodTypes: [IRON_TOOL],
    });
  });

  it('drops the herbalist mushroom record the collector already specializes', () => {
    const tracks = [track(8, COLLECTOR, [MUSHROOM]), track(55, HERBALIST, [MUSHROOM])];
    const corrected = correctJobExperience(tracks, [CULTURESNATION_TRIBE]);
    expect(corrected.map((t) => t.typeId)).toEqual([8]);
  });

  it('leaves a record a mod revision already fixed exactly as it ships', () => {
    const fixed = track(29, CARPENTER, [IRON_TOOL], 'carpenter iron tool');
    expect(correctJobExperience([fixed], [CULTURESNATION_TRIBE])).toEqual([fixed]);
  });

  it('keeps a two-good record whose profession enables both variants', () => {
    const tracks = [track(59, DRUID, [POTION_SMALL, POTION_BIG], 'druid potion food')];
    expect(correctJobExperience(tracks, [CULTURESNATION_TRIBE])).toEqual(tracks);
  });

  it('fails the build on an uncorrected record whose profession does not enable its good', () => {
    const tracks = [track(80, ARMORER, [IRON_TOOL], 'armorer iron tool')];
    expect(() => correctJobExperience(tracks, [CULTURESNATION_TRIBE])).toThrow(
      /"armorer_iron_tool" \(type 80\) specializes job 10 on good 32, which only job 9 enables/,
    );
  });

  it('fails the build when two records specialize the same profession and good', () => {
    const tracks = [
      track(80, CARPENTER, [IRON_TOOL], 'carpenter iron tool'),
      track(81, CARPENTER, [IRON_TOOL], 'carpenter iron tool again'),
    ];
    expect(() => correctJobExperience(tracks, [CULTURESNATION_TRIBE])).toThrow(
      /repeats the job 9 \/ good 32 specialization type 80 already owns/,
    );
  });

  it('skips the owner check when a partial mod tree yielded no jobEnablesGood edges', () => {
    const tracks = [track(29, SMITH, [IRON_TOOL], 'smith iron tool')];
    expect(correctJobExperience(tracks, [tribe([])])).toHaveLength(1);
  });

  it('still rejects a duplicate pairing without a tribe table to compare owners against', () => {
    const tracks = [
      track(80, CARPENTER, [IRON_TOOL], 'carpenter iron tool'),
      track(81, CARPENTER, [IRON_TOOL], 'carpenter iron tool again'),
    ];
    expect(() => correctJobExperience(tracks, [tribe([])])).toThrow(
      /repeats the job 9 \/ good 32 specialization type 80 already owns/,
    );
  });
});
