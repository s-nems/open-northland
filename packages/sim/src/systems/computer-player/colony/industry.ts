// A colony's industries (owner ruling): chosen from what its site offers and what the seat needs, weighed
// against its room, and raised one chain at a time. Pure over the reads below; `./industry-read.ts` takes
// them off the world.

/** The ground a step asks for: a farm's fields, a patch of grass, or any. */
export type StepGround = 'field' | 'grass' | 'any';

/** A chain of buildings a colony raises for its own people or for home. The temple follows a weapon
 *  industry, whose workers must pray. */
export type Industry =
  | 'baking'
  | 'brewing'
  | 'husbandry'
  | 'armoury'
  | 'smithy'
  | 'druid'
  | 'amulets'
  | 'carpentry'
  | 'temple';

export interface ChainStep {
  /** The base tier's stable content id: a building at any tier of its chain counts as this step. */
  readonly building: string;
  readonly ground: StepGround;
  /** The steps that stand before this one goes up. */
  readonly after: readonly string[];
  /** The tier it is raised at: the top tier the tribe has enabled, which must be this one. */
  readonly tier?: string;
  /** A workshop with a large footprint, whose spot may lie past the store's walk range. */
  readonly far?: true;
}

const FARM = 'work_farm_00';
const MILL = 'work_mill_00';
const WELL = 'work_well_00';
const BAKERY = 'work_bakery_00';
const HIVE = 'work_hive_00';
const BREWERY = 'work_brewery';
const ANIMAL_FARM = 'work_animal_farm';
const SEWERY = 'work_sewery_00';
const ARMORY = 'work_armory_00';
const SMITHY = 'work_smithy_00';
const HERB_HUT = 'work_herb_hut';
const MINT = 'work_coin_mint';
const DRUID_HUT = 'work_druid_00';
const TEMPLE = 'work_temple';
const JOINERY = 'work_joinery_00';
/** Owner ruling: the druid hut at its top tier brews the big healing potion, and the carpenter's is the
 *  level-4 joinery, which builds carts. */
const DRUID_TOP = 'work_druid_01';
const JOINERY_TOP = 'work_joinery_03';

/** Owner ruling: the farm, mill, well and bakery on grass, the farm's fields first; and so on per industry.
 *  The well comes once the mill stands, as only the bakery drinks of it. */
const CHAINS: Readonly<Record<Exclude<Industry, 'temple'>, readonly ChainStep[]>> = {
  baking: [
    { building: FARM, ground: 'field', after: [] },
    { building: MILL, ground: 'any', after: [FARM] },
    { building: WELL, ground: 'grass', after: [MILL] },
    { building: BAKERY, ground: 'any', after: [MILL, WELL] },
  ],
  brewing: [
    { building: WELL, ground: 'grass', after: [] },
    { building: HIVE, ground: 'grass', after: [WELL] },
    { building: BREWERY, ground: 'any', after: [WELL, HIVE], far: true },
  ],
  husbandry: [
    { building: WELL, ground: 'grass', after: [] },
    { building: ANIMAL_FARM, ground: 'any', after: [WELL], far: true },
    { building: SEWERY, ground: 'any', after: [ANIMAL_FARM], far: true },
  ],
  armoury: [{ building: ARMORY, ground: 'any', after: [], far: true }],
  smithy: [{ building: SMITHY, ground: 'any', after: [], far: true }],
  druid: [
    { building: WELL, ground: 'grass', after: [] },
    { building: HERB_HUT, ground: 'grass', after: [WELL] },
    { building: MINT, ground: 'any', after: [HERB_HUT], far: true },
    { building: DRUID_HUT, ground: 'any', after: [WELL, HERB_HUT, MINT], tier: DRUID_TOP, far: true },
  ],
  amulets: [{ building: MINT, ground: 'any', after: [], far: true }],
  carpentry: [{ building: JOINERY, ground: 'any', after: [], tier: JOINERY_TOP, far: true }],
};

/** The temple's chain where its holy oil sails in, or comes from the colony's own druids. */
const TEMPLE_CHAIN: readonly ChainStep[] = [{ building: TEMPLE, ground: 'any', after: [], far: true }];
/** Owner ruling: where home boils no holy oil, the colony raises a druid hut for the one unit the temple's
 *  bill takes. The oil's recipe takes mushrooms alone, so no herb hut goes with it. */
const TEMPLE_OIL_CHAIN: readonly ChainStep[] = [
  { building: DRUID_HUT, ground: 'any', after: [], far: true },
  { building: TEMPLE, ground: 'any', after: [DRUID_HUT], far: true },
];

/** What the land of a colony is known to offer. */
export interface SiteFacts {
  /** Plantable ground for a farm's fields, and a patch for a well, a hive or a herb hut. */
  readonly field: boolean;
  readonly grass: boolean;
  /** Live deposits the seat knows of and the colony's men reach. */
  readonly wood: boolean;
  readonly iron: boolean;
  readonly gold: boolean;
  readonly mushroom: boolean;
  /** Wild herds on its land, which its scout can round up. */
  readonly animals: boolean;
  /** The free nodes its block holds for industries past what stands there and the room kept for homes. */
  readonly room: number;
}

/** Owner ruling: what each industry takes of the site. Iron and leather may sail in, so the joinery and
 *  the amulets ask for neither. */
const SITE_FITS: Readonly<Record<Exclude<Industry, 'temple'>, (site: SiteFacts) => boolean>> = {
  baking: (site) => site.field,
  brewing: (site) => site.grass,
  husbandry: (site) => site.animals && site.grass,
  armoury: (site) => site.wood,
  smithy: (site) => site.wood && site.iron,
  druid: (site) => site.grass && site.mushroom && site.gold,
  amulets: (site) => site.gold,
  carpentry: (site) => site.wood,
};

/** What a good is worth to home: one it makes none of, one it makes, or one it makes and holds plenty of
 *  (owner ruling: a colony does not repeat what home makes plenty of). */
export type Worth = 'lacking' | 'wanted' | 'plenty';

const WORTH_POINTS: Readonly<Record<Worth, number>> = { lacking: 2, wanted: 1, plenty: 0 };

/** The goods an industry makes for home, by stable content id: its worth is the best of theirs. Baking feeds
 *  the colony itself, so it is worth a want whatever home holds. Owner ruling: of the joinery's output only
 *  the iron tools go home, and the druid makes the big healing potion alone. */
const HOME_GOODS: Readonly<Record<Exclude<Industry, 'temple'>, readonly string[]>> = {
  baking: [],
  brewing: ['mead'],
  husbandry: ['shoes', 'armor_leather'],
  armoury: ['bow_short', 'spear_wooden'],
  smithy: ['sword_shord', 'sword_long', 'spear_iron'],
  druid: ['potion_heal_big'],
  amulets: ['amulet_strength', 'amulet_defense'],
  carpentry: ['tool_iron'],
};

/** How much an industry's goods weigh against the others' (authored): the army's weapons first, then what
 *  heals and strengthens it, then the settlers' goods. Food for the colony's own people weighs most of all,
 *  as no other industry runs on hungry men. */
const INDUSTRY_WEIGHT: Readonly<Record<Exclude<Industry, 'temple'>, number>> = {
  baking: 12,
  smithy: 6,
  armoury: 5,
  druid: 3,
  amulets: 2,
  husbandry: 2,
  carpentry: 2,
  brewing: 2,
};

/** The industries in the order a tie between their scores keeps. */
const INDUSTRY_ORDER: readonly Exclude<Industry, 'temple'>[] = [
  'baking',
  'smithy',
  'armoury',
  'druid',
  'amulets',
  'husbandry',
  'carpentry',
  'brewing',
];

/** Owner ruling: the industries whose workers must pray, so a temple follows them: the smith, the armourer
 *  and the joiner need religion. */
const PRAYING: ReadonlySet<Industry> = new Set<Industry>(['smithy', 'armoury', 'carpentry']);

/** What the selector reads of the seat and the colony. */
export interface SeatRead {
  readonly worth: (good: string) => Worth;
  /** Whether home boils holy oil. */
  readonly homeMakesHolyOil: boolean;
  /** Whether the tribe has unlocked a step at the tier it is raised at, and its trades have a man in reach. */
  readonly open: (step: ChainStep) => boolean;
  /** The nodes of the colony's block a building takes. */
  readonly roomOf: (step: ChainStep) => number;
  /** The steps raised on the colony, sites included, by base id. */
  readonly raised: ReadonlySet<string>;
}

export interface IndustryChoice {
  readonly industry: Industry;
  readonly steps: readonly ChainStep[];
  /** Its weight times what its goods are worth to home; 0 for the temple, which follows another. */
  readonly score: number;
}

function scoreOf(industry: Exclude<Industry, 'temple'>, seat: SeatRead): number {
  const goods = HOME_GOODS[industry];
  const worth =
    goods.length === 0 ? WORTH_POINTS.wanted : Math.max(...goods.map((g) => WORTH_POINTS[seat.worth(g)]));
  return INDUSTRY_WEIGHT[industry] * worth;
}

/** The steps more than one chain holds, as the well, the mint and the temple's druid hut: raising one starts none of them. */
const SHARED_STEPS: ReadonlySet<string> = new Set(
  [...Object.values(CHAINS), TEMPLE_OIL_CHAIN]
    .flat()
    .map((step) => step.building)
    .filter((building, i, all) => all.indexOf(building) !== i),
);

/** Owner ruling: an amulet takes a short sword or a leather armour beside its gold and iron, so the mint
 *  makes them only where the colony's land could arm a smithy or a tailor, or home makes either. */
function fed(industry: Exclude<Industry, 'temple'>, site: SiteFacts, seat: SeatRead): boolean {
  if (industry !== 'amulets') return true;
  const made = (good: string): boolean => seat.worth(good) !== 'lacking';
  return SITE_FITS.smithy(site) || SITE_FITS.husbandry(site) || made('sword_shord') || made('armor_leather');
}

/** Whether a building of `steps` of its own stands on the colony, or its site. */
function started(steps: readonly ChainStep[], seat: SeatRead): boolean {
  return steps.some((step) => seat.raised.has(step.building) && !SHARED_STEPS.has(step.building));
}

/** The room `steps` still take that `planned` has not: a well two chains share is paid once. */
function roomStill(steps: readonly ChainStep[], seat: SeatRead, planned: Set<string>): number {
  let room = 0;
  for (const step of steps)
    if (!seat.raised.has(step.building) && !planned.has(step.building)) room += seat.roomOf(step);
  return room;
}

/** The temple's chain for `chosen`, or null with no praying crew among them, or no holy oil to be had. */
function templeSteps(
  chosen: readonly IndustryChoice[],
  site: SiteFacts,
  seat: SeatRead,
): readonly ChainStep[] | null {
  if (!chosen.some((c) => PRAYING.has(c.industry))) return null;
  if (seat.homeMakesHolyOil || chosen.some((c) => c.industry === 'druid')) return TEMPLE_CHAIN;
  return site.mushroom ? TEMPLE_OIL_CHAIN : null;
}

/**
 * The industries a colony runs, in the order it raises them (owner ruling): each one its site fits, whose
 * buildings its tribe has and its trades can staff, and whose goods home does not hold plenty of; by score,
 * so a cramped colony gets the most valuable first, while their buildings fit its room. An industry it has
 * started stays chosen. A temple follows the first whose workers pray. A site with room and nothing else
 * chooses none, and grows people.
 */
export function chooseIndustries(site: SiteFacts, seat: SeatRead): IndustryChoice[] {
  const candidates = INDUSTRY_ORDER.flatMap((industry) => {
    const steps = CHAINS[industry];
    const score = scoreOf(industry, seat);
    const begun = started(steps, seat);
    const fits =
      SITE_FITS[industry](site) && steps.every(seat.open) && score > 0 && fed(industry, site, seat);
    return begun || fits ? [{ industry, steps, score, begun }] : [];
  });
  candidates.sort((a, b) => Number(b.begun) - Number(a.begun) || b.score - a.score);
  const planned = new Set<string>();
  let room = site.room;
  const chosen: IndustryChoice[] = [];
  const fits = (steps: readonly ChainStep[], begun: boolean): boolean => {
    const cost = roomStill(steps, seat, planned);
    if (!begun && cost > room) return false;
    room -= cost;
    for (const step of steps) planned.add(step.building);
    return true;
  };
  for (const { industry, steps, score, begun } of candidates)
    if (fits(steps, begun)) chosen.push({ industry, steps, score });
  const temple = templeSteps(chosen, site, seat);
  if (temple === null || !temple.every(seat.open) || !fits(temple, started(temple, seat))) return chosen;
  // It goes up straight after the first industry whose crew prays.
  chosen.splice(chosen.findIndex((c) => PRAYING.has(c.industry)) + 1, 0, {
    industry: 'temple',
    steps: temple,
    score: 0,
  });
  return chosen;
}

/** One look at what the colony has raised and how it eats. */
export interface StepRead {
  /** The steps raised, sites included, and those standing, by base id. */
  readonly raised: ReadonlySet<string>;
  readonly standing: ReadonlySet<string>;
  /** Whether the colony's food runs under its comfort past the fishers' start. */
  readonly hungry: boolean;
  /** Whether the colony runs and holds a meal a mouth: what every other industry waits for. */
  readonly settled: boolean;
  readonly open: (step: ChainStep) => boolean;
}

/** Whether `industry` runs now. Owner ruling: food is raised as the colony needs it, not all at founding, so
 *  baking runs only while the colony is hungry; husbandry's meat feeds a hungry colony with no field for a
 *  farm, and runs for home once it is settled; every other runs once it is settled. */
function runs(industry: Industry, chosen: readonly IndustryChoice[], read: StepRead): boolean {
  if (industry === 'baking') return read.hungry;
  const feeds = industry === 'husbandry' && !chosen.some((c) => c.industry === 'baking');
  return read.settled || (feeds && read.hungry);
}

/**
 * The next steps of `chosen`, in order: one industry at a time, as each site draws on home's materials. A site
 * still open holds the rest back; an industry whose next step its tribe or men cannot take yet is passed
 * over. Each later industry's next step follows, for a placement that finds no spot for the first.
 */
export function nextIndustrySteps(chosen: readonly IndustryChoice[], read: StepRead): ChainStep[] {
  const next: ChainStep[] = [];
  for (const { industry, steps } of chosen) {
    if (!runs(industry, chosen, read)) continue;
    if (steps.some((s) => read.raised.has(s.building) && !read.standing.has(s.building))) return next;
    const step = steps.find(
      (s) => !read.raised.has(s.building) && s.after.every((b) => read.standing.has(b)) && read.open(s),
    );
    if (step !== undefined && !next.some((s) => s.building === step.building)) next.push(step);
  }
  return next;
}

/** The steps of `chosen` not raised yet, whatever the moment: what the colony keeps goods for. */
export function stepsAhead(chosen: readonly IndustryChoice[], raised: ReadonlySet<string>): ChainStep[] {
  const ahead: ChainStep[] = [];
  for (const { steps } of chosen)
    for (const step of steps)
      if (!raised.has(step.building) && !ahead.some((s) => s.building === step.building)) ahead.push(step);
  return ahead;
}

/** Every step of every chain, once each. */
export const ALL_STEPS: readonly ChainStep[] = [...Object.values(CHAINS).flat(), ...TEMPLE_OIL_CHAIN].filter(
  (step, i, all) => all.findIndex((s) => s.building === step.building) === i,
);

/** The step of any chain raised as `building`, at its base or its tier. */
export function chainStepOf(building: string): ChainStep | undefined {
  return ALL_STEPS.find((step) => step.building === building || step.tier === building);
}

/** A good the colony wants delivered up to `upTo` units, by stable content id. */
export interface IndustryWant {
  readonly good: string;
  readonly upTo: number;
}

/** The holy oil a temple's bill takes. */
const TEMPLE_OIL_UNITS = 1;

/**
 * What `chosen` needs delivered that no workshop of the colony takes as a recipe input, so the generic rule
 * of bringing a standing workshop's inputs cannot know it: the temple's unit of holy oil, while home boils it.
 */
export function colonyIndustryWants(
  chosen: readonly IndustryChoice[],
  homeMakesHolyOil: boolean,
): readonly IndustryWant[] {
  const temple = chosen.some((c) => c.industry === 'temple');
  return temple && homeMakesHolyOil ? [{ good: 'holy_oil', upTo: TEMPLE_OIL_UNITS }] : [];
}
