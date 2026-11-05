import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_ORDER } from '../../../../../src/systems/computer-player/build-order/default-order.js';
import { orderSteps } from '../../../../../src/systems/computer-player/build-order/entries.js';
import {
  ALL_STEPS,
  type ChainStep,
  chainStepOf,
  chooseIndustries,
  colonyIndustryWants,
  earningDeposits,
  type Industry,
  type IndustryChoice,
  nextIndustrySteps,
  type SeatRead,
  type SiteFacts,
  type StepRead,
  type Worth,
} from '../../../../../src/systems/computer-player/colony/settlement/industry.js';

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
      [{ gold: true, wood: true, iron: true }, 'amulets'],
    ];
    for (const [site, industry] of fits)
      expect(industries(chooseIndustries({ ...BARE, ...site }, seatRead()))).toContain(industry);
    expect(industries(chooseIndustries({ ...BARE, iron: true }, seatRead()))).not.toContain('smithy');
    expect(industries(chooseIndustries({ ...BARE, animals: true }, seatRead()))).not.toContain('husbandry');
    expect(industries(chooseIndustries({ ...BARE, gold: true, grass: true }, seatRead()))).not.toContain(
      'druid',
    );
  });

  it('mints amulets only where a sword or a leather armour can be had', () => {
    const noSwords = (good: string): Worth =>
      good === 'sword_shord' || good === 'armor_leather' ? 'lacking' : 'wanted';
    expect(industries(chooseIndustries({ ...BARE, gold: true }, seatRead({ worth: noSwords })))).toEqual([]);
    const homeSwords = (good: string): Worth => (good === 'sword_shord' ? 'wanted' : 'lacking');
    expect(industries(chooseIndustries({ ...BARE, gold: true }, seatRead({ worth: homeSwords })))).toEqual([
      'amulets',
    ]);
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
    expect(industries(chooseIndustries(site, seatRead()))).toEqual(['armoury']);
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

  it('raises the joinery at the tier the ruling names and takes the druid hut up to its top', () => {
    const choices = chooseIndustries(RICH, seatRead());
    const steps = choices.flatMap((c) => c.steps);
    expect(steps.flatMap((s) => (s.tier === undefined ? [] : [s.tier]))).toContain('work_joinery_03');
    expect(steps.flatMap((s) => (s.top === undefined ? [] : [s.top]))).toContain('work_druid_01');
  });

  it('chooses the druids before home has their trades, gathering the mushrooms that earn the first', () => {
    const unearned = new Set(['work_herb_hut', 'work_druid_00']);
    const open = (step: ChainStep) => !unearned.has(step.building);
    const site = { ...BARE, grass: true, mushroom: true, gold: true };
    const choices = chooseIndustries(site, seatRead({ open }));
    expect(industries(choices)).toContain('druid');
    expect(earningDeposits(choices, open)).toEqual(['mushroom']);
    expect(earningDeposits(choices, () => true)).toEqual([]);
  });
});

describe('a colony temple', () => {
  const temple = (choices: readonly IndustryChoice[]): readonly string[] =>
    choices.find((c) => c.industry === 'temple')?.steps.map((s) => s.building) ?? [];

  it('follows the first industry whose workers pray, on the oil home boils', () => {
    const choices = chooseIndustries({ ...BARE, wood: true }, seatRead());
    expect(industries(choices)).toEqual(['armoury', 'temple', 'carpentry']);
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
  running: true,
  open: () => true,
  ...over,
});

describe('a colony chain', () => {
  const choices = chooseIndustries({ ...BARE, field: true, wood: true }, seatRead());
  const next = (read: StepRead): string[] => nextIndustrySteps(choices, read).map((s) => s.building);

  it('raises its food one step standing before the next, fed or hungry', () => {
    expect(next(stepRead({}))[0]).toBe('work_farm_00');
    expect(next(stepRead({}, ['work_farm_00']))[0]).toBe('work_mill_00');
    expect(next(stepRead({}, ['work_farm_00', 'work_mill_00']))[0]).toBe('work_well_00');
  });

  it('starts every chain it chose once the colony runs, none before', () => {
    expect(next(stepRead({}))).toEqual(['work_farm_00', 'work_armory_00', 'work_joinery_00']);
    expect(next(stepRead({ running: false }))).toEqual([]);
  });

  it('holds back only the chain whose site stands open', () => {
    const farmSite = stepRead({ raised: new Set(['work_farm_00']) });
    expect(next(farmSite)).toEqual(['work_armory_00', 'work_joinery_00']);
    expect(next(stepRead({}, ['work_armory_00']))).toContain('work_temple');
  });

  it('passes over a step nobody can take yet', () => {
    const noArmory = (step: ChainStep): boolean => step.building !== 'work_armory_00';
    expect(next(stepRead({ open: noArmory }))).not.toContain('work_armory_00');
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
    const choices = chooseIndustries({ ...BARE, wood: true }, seatRead());
    expect(nextIndustrySteps(choices, stepRead({})).map((s) => s.building)).toEqual([
      'work_armory_00',
      'work_joinery_00',
    ]);
  });

  it('starts no druid chain for the druid hut its temple boils oil in', () => {
    const site = { ...BARE, wood: true, grass: true, mushroom: true };
    const read = seatRead({ homeMakesHolyOil: false, raised: new Set(['work_druid_00']) });
    expect(industries(chooseIndustries(site, read))).not.toContain('druid');
  });
});

describe('a colony workshop at home’s level', () => {
  it('is the same chain step at its base and at the tier home lifts it to', () => {
    expect(chainStepOf('work_smithy_01')).toBe(chainStepOf('work_smithy_00'));
    expect(chainStepOf('work_bakery_01')?.top).toBe('work_bakery_01');
  });

  it('goes up to the highest tier home’s default build order places or lifts it to', () => {
    const homeTiers = orderSteps(DEFAULT_BUILD_ORDER).flatMap((entry) =>
      entry.kind === 'place' || entry.kind === 'upgrade' ? [entry.building] : [],
    );
    for (const step of ALL_STEPS.filter((s) => s.top !== undefined)) {
      const chain = chainOf(step.building);
      const homeTop = homeTiers
        .filter((id) => chainOf(id) === chain)
        .sort()
        .at(-1);
      expect({ chain, top: step.top }).toEqual({ chain, top: homeTop });
    }
  });
});

/** A workshop tier's content id ends in its two-digit level: `work_bakery_01` is the bakery's second. */
const TIER_LEVEL = /_\d\d$/;

/** The chain a tier's content id belongs to, its level cut off. */
function chainOf(id: string): string {
  return id.replace(TIER_LEVEL, '');
}
