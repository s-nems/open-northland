import { describe, expect, it } from 'vitest';
import {
  type ChainStep,
  chooseIndustries,
  colonyIndustryWants,
  type Industry,
  type IndustryChoice,
  nextIndustrySteps,
  type SeatRead,
  type SiteFacts,
  type StepRead,
  type Worth,
} from '../../../../src/systems/computer-player/colony/industry.js';

/** Room enough for every chain at once. */
const ROOMY = 100_000;
/** What one building takes of the block in these reads. */
const BUILDING_ROOM = 100;

const BARE: SiteFacts = {
  field: false,
  grass: false,
  wood: false,
  iron: false,
  gold: false,
  mushroom: false,
  animals: false,
  room: ROOMY,
};
const RICH: SiteFacts = {
  field: true,
  grass: true,
  wood: true,
  iron: true,
  gold: true,
  mushroom: true,
  animals: true,
  room: ROOMY,
};

const seatRead = (over: Partial<SeatRead> = {}): SeatRead => ({
  worth: () => 'lacking',
  homeMakesHolyOil: true,
  open: () => true,
  roomOf: () => BUILDING_ROOM,
  raised: new Set(),
  ...over,
});

const industries = (choices: readonly IndustryChoice[]): Industry[] => choices.map((c) => c.industry);

describe('a colony industry', () => {
  it('is chosen only where the site offers what its chain takes', () => {
    const fits: readonly [Partial<SiteFacts>, Industry][] = [
      [{ field: true }, 'baking'],
      [{ grass: true }, 'brewing'],
      [{ wood: true }, 'armoury'],
      [{ wood: true, iron: true }, 'smithy'],
      [{ grass: true, animals: true }, 'husbandry'],
      [{ grass: true, mushroom: true, gold: true }, 'druid'],
      [{ gold: true }, 'amulets'],
    ];
    for (const [site, industry] of fits)
      expect(industries(chooseIndustries({ ...BARE, ...site }, seatRead()))).toContain(industry);
    expect(industries(chooseIndustries({ ...BARE, iron: true }, seatRead()))).not.toContain('smithy');
    expect(industries(chooseIndustries({ ...BARE, animals: true }, seatRead()))).not.toContain('husbandry');
    expect(industries(chooseIndustries({ ...BARE, gold: true, grass: true }, seatRead()))).not.toContain(
      'druid',
    );
  });

  it('is none on a site with room alone, which grows people', () => {
    expect(chooseIndustries(BARE, seatRead())).toEqual([]);
  });

  it('repeats nothing home makes plenty of', () => {
    const plentyOfSpears = (good: string): Worth =>
      good === 'spear_wooden' || good === 'bow_short' ? 'plenty' : 'lacking';
    expect(
      industries(chooseIndustries({ ...BARE, wood: true }, seatRead({ worth: plentyOfSpears }))),
    ).not.toContain('armoury');
  });

  it('ranks what home lacks over what it makes, food for the colony first', () => {
    const homeSmiths = (good: string): Worth =>
      good.startsWith('sword') || good === 'spear_iron' ? 'wanted' : 'lacking';
    const site = { ...BARE, field: true, wood: true, iron: true };
    expect(industries(chooseIndustries(site, seatRead({ worth: homeSmiths })))).toEqual([
      'baking',
      'armoury',
      'temple',
      'smithy',
      'carpentry',
    ]);
  });

  it('takes the most valuable first on a cramped site, while its buildings fit', () => {
    const site = { ...BARE, wood: true, iron: true, room: BUILDING_ROOM };
    expect(industries(chooseIndustries(site, seatRead()))).toEqual(['smithy']);
  });

  it('pays once for a well two chains share', () => {
    // Brewing takes a well, a hive and a brewery; husbandry its well, an animal farm and a tailor.
    const room = 5 * BUILDING_ROOM;
    const site = { ...BARE, grass: true, animals: true, room };
    expect(industries(chooseIndustries(site, seatRead()))).toEqual(['husbandry', 'brewing']);
  });

  it('keeps one it has started though home since holds plenty', () => {
    const site = { ...BARE, wood: true };
    const read = seatRead({ worth: () => 'plenty', raised: new Set(['work_armory_00']) });
    expect(industries(chooseIndustries(site, read))).toContain('armoury');
  });

  it('waits for a building the tribe has not unlocked or no man can work', () => {
    const noSmithy = (step: ChainStep): boolean => step.building !== 'work_smithy_00';
    const site = { ...BARE, wood: true, iron: true };
    expect(industries(chooseIndustries(site, seatRead({ open: noSmithy })))).not.toContain('smithy');
  });

  it('raises the joinery and the druid hut at the tier the ruling names', () => {
    const choices = chooseIndustries(RICH, seatRead());
    const tiers = choices.flatMap((c) => c.steps.flatMap((s) => (s.tier === undefined ? [] : [s.tier])));
    expect(tiers).toEqual(expect.arrayContaining(['work_joinery_03', 'work_druid_01']));
  });
});

describe('a colony temple', () => {
  const temple = (choices: readonly IndustryChoice[]): readonly string[] =>
    choices.find((c) => c.industry === 'temple')?.steps.map((s) => s.building) ?? [];

  it('follows the first industry whose workers pray, on the oil home boils', () => {
    const choices = chooseIndustries({ ...BARE, wood: true, gold: true }, seatRead());
    expect(industries(choices)).toEqual(['armoury', 'temple', 'amulets', 'carpentry']);
    expect(temple(choices)).toEqual(['work_temple']);
  });

  it('stands no temple for workers who do not pray', () => {
    expect(industries(chooseIndustries({ ...BARE, gold: true }, seatRead()))).not.toContain('temple');
  });

  it('boils its own oil in a druid hut first where home boils none', () => {
    const site = { ...BARE, wood: true, mushroom: true };
    expect(temple(chooseIndustries(site, seatRead({ homeMakesHolyOil: false })))).toEqual([
      'work_druid_00',
      'work_temple',
    ]);
    expect(
      industries(chooseIndustries({ ...BARE, wood: true }, seatRead({ homeMakesHolyOil: false }))),
    ).not.toContain('temple');
  });
});

const stepRead = (over: Partial<StepRead>, standing: readonly string[] = []): StepRead => ({
  raised: new Set(standing),
  standing: new Set(standing),
  hungry: false,
  settled: true,
  open: () => true,
  ...over,
});

describe('a colony chain', () => {
  const choices = chooseIndustries({ ...BARE, field: true, wood: true }, seatRead());
  const next = (read: StepRead): string | null => nextIndustrySteps(choices, read)[0]?.building ?? null;

  it('raises its food while the colony is hungry, one standing before the next', () => {
    expect(next(stepRead({ hungry: true }))).toBe('work_farm_00');
    expect(next(stepRead({ hungry: true }, ['work_farm_00']))).toBe('work_mill_00');
    expect(next(stepRead({ hungry: true }, ['work_farm_00', 'work_mill_00']))).toBe('work_well_00');
  });

  it('passes its food over while the colony eats, and its others until it is settled', () => {
    expect(next(stepRead({}))).toBe('work_armory_00');
    expect(next(stepRead({ settled: false }))).toBeNull();
  });

  it('holds the next industry back while a site of one stands open', () => {
    expect(next(stepRead({ raised: new Set(['work_armory_00']) }))).toBeNull();
    expect(next(stepRead({}, ['work_armory_00']))).toBe('work_temple');
  });

  it('passes over a step nobody can take yet', () => {
    const noArmory = (step: ChainStep): boolean => step.building !== 'work_armory_00';
    expect(next(stepRead({ open: noArmory }))).toBe('work_temple');
  });
});

describe('what a colony industry wants brought', () => {
  it('is the unit of holy oil a temple takes, while home boils it', () => {
    const choices = chooseIndustries({ ...BARE, wood: true }, seatRead());
    expect(colonyIndustryWants(choices, true)).toEqual([{ good: 'holy_oil', upTo: 1 }]);
    expect(colonyIndustryWants(choices, false)).toEqual([]);
    expect(colonyIndustryWants([], true)).toEqual([]);
  });
});

describe('a colony chain held up', () => {
  it('offers the next industry where the first finds no spot', () => {
    const choices = chooseIndustries({ ...BARE, wood: true, gold: true }, seatRead());
    expect(nextIndustrySteps(choices, stepRead({})).map((s) => s.building)).toEqual([
      'work_armory_00',
      'work_temple',
      'work_coin_mint',
      'work_joinery_00',
    ]);
  });

  it('feeds a hungry colony with no field from its animal farm', () => {
    const choices = chooseIndustries({ ...BARE, grass: true, animals: true }, seatRead());
    const read = stepRead({ hungry: true, settled: false }, ['work_well_00']);
    expect(nextIndustrySteps(choices, read)[0]?.building).toBe('work_animal_farm');
  });

  it('starts no druid chain for the druid hut its temple boils oil in', () => {
    const site = { ...BARE, wood: true, grass: true, mushroom: true };
    const read = seatRead({ homeMakesHolyOil: false, raised: new Set(['work_druid_00']) });
    expect(industries(chooseIndustries(site, read))).not.toContain('druid');
  });
});
