import { systems } from '@open-northland/sim';
import { JOB_HERO_UNARMED, JOB_HEROINE_BOW, JOB_HUNTER, JOB_SOLDIER_UNARMED } from '../../catalog/jobs.js';
import { buildingHitpoints, type KnowledgeBase } from './base.js';
import { rawCost, recipesOf } from './chains.js';
import { combatTargets, isHeroWeapon, landed, shownWeapons, stepSeconds, weaponsOf } from './combat.js';
import { cadenceText, preciseSecondsText, rangeText, wholeText } from './entry-format.js';
import type {
  EntryRef,
  KnowledgeAnimal,
  KnowledgeBuilding,
  KnowledgeGood,
  KnowledgeJob,
  KnowledgeNamedId,
  KnowledgeTech,
  KnowledgeVehicle,
  KnowledgeWeapon,
} from './model.js';

export type EntryCategory =
  | 'goods'
  | 'arms'
  | 'buildings'
  | 'wonders'
  | 'jobs'
  | 'vehicles'
  | 'animals'
  | 'tribes';

export type EntryFamily =
  | 'good'
  | 'weapon'
  | 'armour'
  | 'building'
  | 'wonder'
  | 'job'
  | 'vehicle'
  | 'animal'
  | 'tribe';

export interface EntryPlace {
  readonly category: EntryCategory;
  readonly family: EntryFamily;
  /** The entry a link lands on: a vehicle's good and yard open the vehicle. */
  readonly entry: EntryRef;
}

export const ENTRY_CATEGORIES: readonly EntryCategory[] = [
  'goods',
  'arms',
  'buildings',
  'wonders',
  'jobs',
  'vehicles',
  'animals',
  'tribes',
];

const armsIndexes = new WeakMap<KnowledgeBase, ReadonlySet<number>>();

/** The goods a soldier fights in: every armour's and every hand weapon's. A catapult's row names its stone. */
function armsGoods(base: KnowledgeBase): ReadonlySet<number> {
  const known = armsIndexes.get(base);
  if (known !== undefined) return known;
  const types = new Set<number>();
  for (const armor of base.armor) if (armor.goodType !== null) types.add(armor.goodType);
  for (const rows of base.weapons.values()) {
    for (const weapon of rows) {
      if (weapon.goodType !== null && !isCatapultWeapon(weapon)) types.add(weapon.goodType);
    }
  }
  armsIndexes.set(base, types);
  return types;
}

const isCatapultWeapon = (weapon: Pick<KnowledgeWeapon, 'mainType'>): boolean =>
  weapon.mainType === systems.WEAPON_MAIN_TYPE.CATAPULT;

export const isArmsGood = (base: KnowledgeBase, good: KnowledgeGood): boolean =>
  armsGoods(base).has(good.typeId);

const isVehicleId = (base: KnowledgeBase, id: string): boolean => base.vehicles.some((v) => v.id === id);

/** The category and page an entry belongs to. */
export function placeOf(base: KnowledgeBase, ref: EntryRef): EntryPlace {
  const vehicle = (id: string): EntryPlace => ({
    category: 'vehicles',
    family: 'vehicle',
    entry: { kind: 'vehicle', id },
  });
  switch (ref.kind) {
    case 'good': {
      if (isVehicleId(base, ref.id)) return vehicle(ref.id);
      const good = base.goodById.get(ref.id);
      if (good === undefined || !isArmsGood(base, good)) {
        return { category: 'goods', family: 'good', entry: ref };
      }
      const armour = base.armor.some((a) => a.goodType === good.typeId);
      return { category: 'arms', family: armour ? 'armour' : 'weapon', entry: ref };
    }
    case 'building': {
      const kind = base.buildingById.get(ref.id)?.kind;
      if (kind === 'vehicle') return vehicle(ref.id);
      return kind === 'wonder'
        ? { category: 'wonders', family: 'wonder', entry: ref }
        : { category: 'buildings', family: 'building', entry: ref };
    }
    case 'job':
      return { category: 'jobs', family: 'job', entry: ref };
    case 'vehicle':
      return vehicle(ref.id);
    case 'animal':
      return { category: 'animals', family: 'animal', entry: ref };
    case 'tribe':
      return { category: 'tribes', family: 'tribe', entry: ref };
  }
}

export interface CategoryRow {
  readonly entry: EntryRef;
  readonly name: string;
}

/** A category's rows, unsorted; the view sorts by the reader's locale. */
export function categoryRows(base: KnowledgeBase, category: EntryCategory): readonly CategoryRow[] {
  const goods = (kept: (good: KnowledgeGood) => boolean): readonly CategoryRow[] =>
    base.goods.filter(kept).map((g) => ({ entry: { kind: 'good', id: g.id }, name: g.name }));
  const buildings = (kept: (building: KnowledgeBuilding) => boolean): readonly CategoryRow[] =>
    base.buildings.filter(kept).map((b) => ({ entry: { kind: 'building', id: b.id }, name: b.name }));
  switch (category) {
    case 'goods':
      return goods((g) => !isArmsGood(base, g) && !isVehicleId(base, g.id));
    case 'arms':
      return goods((g) => isArmsGood(base, g));
    case 'buildings':
      return buildings((b) => b.kind !== 'vehicle' && b.kind !== 'wonder');
    case 'wonders':
      return buildings((b) => b.kind === 'wonder');
    case 'jobs':
      return base.jobs.map((j) => ({ entry: { kind: 'job', id: j.id }, name: j.name }));
    case 'vehicles':
      return base.vehicles.map((v) => ({ entry: { kind: 'vehicle', id: v.id }, name: v.name }));
    case 'animals':
      return base.animals.map((a) => ({ entry: { kind: 'animal', id: String(a.tribe) }, name: a.name }));
    case 'tribes':
      return base.tribes.map((t) => ({ entry: { kind: 'tribe', id: String(t.typeId) }, name: t.name }));
  }
}

export type GoodBlock = 'status' | 'effect' | 'obtain' | 'uses' | 'cost' | 'links' | 'origin';

export function goodBlocks(good: KnowledgeGood, shows: { readonly cost: boolean }): readonly GoodBlock[] {
  const effect = good.equip !== null || good.meal !== null;
  return [
    'status',
    ...(effect ? (['effect'] as const) : []),
    'obtain',
    'uses',
    ...(shows.cost ? (['cost'] as const) : []),
    'links',
    'origin',
  ];
}

/** Whether the raw cost tells more than the first recipe: with one step it would repeat the bill. */
export function rawCostAddsSteps(base: KnowledgeBase, good: KnowledgeGood): boolean {
  const raw = rawCost(base, good.typeId);
  if (raw.has(good.typeId)) return false;
  const bill = recipesOf(base, good.typeId)[0]?.recipe.inputs;
  if (bill === undefined || good.vehicleHouse !== null) return raw.size > 0;
  return bill.length !== raw.size || bill.some((input) => raw.get(input.goodType) !== input.amount);
}

export type BuildingBlock =
  | 'status'
  | 'output'
  | 'capacity'
  | 'teaches'
  | 'workers'
  | 'build'
  | 'discover'
  | 'levels'
  | 'health'
  | 'links'
  | 'origin';

export function buildingBlocks(
  building: KnowledgeBuilding,
  shows: { readonly capacity: boolean; readonly teaches: boolean; readonly levels: boolean },
): readonly BuildingBlock[] {
  return [
    'status',
    ...(building.recipes.length > 0 ? (['output'] as const) : []),
    ...(shows.capacity ? (['capacity'] as const) : []),
    ...(shows.teaches ? (['teaches'] as const) : []),
    ...(building.workers.length > 0 ? (['workers'] as const) : []),
    'build',
    ...(building.tech === null ? [] : (['discover'] as const)),
    ...(shows.levels ? (['levels'] as const) : []),
    'health',
    'links',
    'origin',
  ];
}

export interface BuildingCapacity {
  /** What each shelf holds when a storehouse shelves its goods alike. */
  readonly store: { readonly perGood: number; readonly goods: number } | null;
  /** The food a home keeps, off its first shelf. */
  readonly larder: number | null;
  readonly families: number;
  readonly pupils: number;
}

export function buildingCapacity(building: KnowledgeBuilding): BuildingCapacity {
  const shelf = building.stock[0];
  const uniform = shelf !== undefined && building.stock.every((s) => s.capacity === shelf.capacity);
  const home = building.homeSize > 0;
  const stores = building.kind === 'storage' || building.kind === 'tower' || building.kind === 'training';
  return {
    store: stores && uniform ? { perGood: shelf.capacity, goods: building.stock.length } : null,
    larder: home ? (shelf?.capacity ?? null) : null,
    families: building.homeSize,
    pupils: building.schoolSize,
  };
}

export const capacityShows = (capacity: BuildingCapacity): boolean =>
  capacity.store !== null || capacity.larder !== null || capacity.families > 0 || capacity.pupils > 0;

/** What a school teaches: the trades and crafts with a lesson row. */
export function schoolCourses(base: KnowledgeBase): {
  readonly jobs: readonly KnowledgeJob[];
  readonly goods: readonly KnowledgeGood[];
} {
  const taught = (rows: readonly { readonly route: string }[] | undefined): boolean =>
    rows?.some((r) => r.route === 'train') ?? false;
  return {
    jobs: base.jobs.filter((job) => taught(job.requirements)),
    goods: base.goods.filter((good) => taught(base.goodRequirements.get(good.typeId))),
  };
}

/** The house a building upgrades from. */
export const previousLevel = (
  base: KnowledgeBase,
  building: KnowledgeBuilding,
): KnowledgeBuilding | undefined => base.buildings.find((b) => b.upgradeTarget === building.typeId);

/** The whole upgrade line a building stands on, lowest first; a house with no line is its own. */
export function levelChain(base: KnowledgeBase, building: KnowledgeBuilding): readonly KnowledgeBuilding[] {
  const seen = new Set<number>([building.typeId]);
  const line = [building];
  for (let below = previousLevel(base, building); below !== undefined; below = previousLevel(base, below)) {
    if (seen.has(below.typeId)) break;
    seen.add(below.typeId);
    line.unshift(below);
  }
  let top: KnowledgeBuilding = building;
  while (top.upgradeTarget !== null) {
    const next = base.buildingByType.get(top.upgradeTarget);
    if (next === undefined || seen.has(next.typeId)) break;
    seen.add(next.typeId);
    line.push(next);
    top = next;
  }
  return line;
}

export type TechRows = Pick<KnowledgeTech, 'jobs' | 'goods'>;

/** The discoveries a locked house still waits for, read off the seat's missing names. */
export function missingTech(tech: KnowledgeTech, missing: readonly string[]): TechRows {
  const open = new Set(missing);
  const held = (row: KnowledgeNamedId): boolean => open.has(row.name);
  return { jobs: tech.jobs.filter(held), goods: tech.goods.filter(held) };
}

export const techSize = (tech: TechRows): number => tech.jobs.length + tech.goods.length;

export type JobFamily = 'hero' | 'soldier' | 'trade';

export function jobFamily(job: Pick<KnowledgeJob, 'typeId'>): JobFamily {
  if (job.typeId >= JOB_HERO_UNARMED && job.typeId <= JOB_HEROINE_BOW) return 'hero';
  return job.typeId >= JOB_SOLDIER_UNARMED ? 'soldier' : 'trade';
}

export type JobBlock = 'film' | 'does' | 'worksIn' | 'weapon' | 'learn' | 'train' | 'leadsTo' | 'links';

/** A hero is found, never taught, so his page has no way to learn it and leads nowhere. */
export function jobBlocks(family: JobFamily, shows: { readonly does: boolean }): readonly JobBlock[] {
  if (family === 'hero') return ['film', 'weapon', 'links'];
  if (family === 'soldier') return ['film', 'weapon', 'train', 'leadsTo', 'links'];
  return ['film', ...(shows.does ? (['does'] as const) : []), 'worksIn', 'learn', 'leadsTo', 'links'];
}

/** The trades this one's practice opens. A hero's requirement counts a fight, not a career. */
export const jobsLedTo = (base: KnowledgeBase, job: KnowledgeJob): readonly KnowledgeJob[] =>
  base.jobs.filter(
    (next) =>
      jobFamily(next) !== 'hero' &&
      next.requirements.some((r) => r.route === 'need' && r.fromJobs.includes(job.typeId)),
  );

/** The row a job fights with for `tribe`. */
export const jobWeapon = (
  base: KnowledgeBase,
  job: Pick<KnowledgeJob, 'typeId'>,
  tribe: number,
): KnowledgeWeapon | undefined => weaponsOf(base, tribe).find((w) => w.jobType === job.typeId);

export type VehicleBlock = 'purpose' | 'numbers' | 'build' | 'links' | 'origin';

export const VEHICLE_BLOCKS: readonly VehicleBlock[] = ['purpose', 'numbers', 'build', 'links', 'origin'];

/** The vehicle's numbers worth a row: a zero says only that it lacks the thing. */
export const vehicleHolds = (
  vehicle: KnowledgeVehicle,
): { readonly cargo: boolean; readonly passengers: boolean } => ({
  cargo: vehicle.stockSlots > 0,
  passengers: vehicle.passengerSlots > 0,
});

/** The weapon a vehicle fires, if any. */
export const vehicleWeapon = (
  base: KnowledgeBase,
  vehicle: KnowledgeVehicle,
  tribe: number,
): KnowledgeWeapon | undefined => weaponsOf(base, tribe).find((w) => w.jobType === vehicle.jobType);

export type AnimalBlock = 'yields' | 'facts' | 'film' | 'hunt' | 'attack' | 'links';

export const animalBlocks = (animal: KnowledgeAnimal): readonly AnimalBlock[] => [
  ...(animal.carcass.length > 0 ? (['yields'] as const) : []),
  'facts',
  'film',
  'hunt',
  ...(animal.weapon === null ? [] : (['attack'] as const)),
  'links',
];

/** The hunter's weapon leads an animal's hunting table, the rest fold under it. */
export function huntWeapons(
  base: KnowledgeBase,
  tribe: number,
): { readonly hunter: KnowledgeWeapon | undefined; readonly rest: readonly KnowledgeWeapon[] } {
  return {
    hunter: weaponsOf(base, tribe).find((w) => w.jobType === JOB_HUNTER),
    rest: tribeWeapons(base, tribe),
  };
}

/** A tribe's weapons in table order: the catapult is a vehicle's shot, so it closes the list. */
export function tribeWeapons(base: KnowledgeBase, tribe: number): readonly KnowledgeWeapon[] {
  const rows = shownWeapons(base, tribe);
  return [...rows.filter((w) => !isCatapultWeapon(w)), ...rows.filter(isCatapultWeapon)];
}

/** A tribe's heroes: the rows held by a hero's job, whatever the row's own id says. */
export function tribeHeroes(base: KnowledgeBase, tribe: number): readonly KnowledgeWeapon[] {
  const seen = new Set<number>();
  return weaponsOf(base, tribe).filter((w) => {
    if (!w.usable || w.jobType === null || !isHeroWeapon(w)) return false;
    if (jobFamily({ typeId: w.jobType }) !== 'hero' || seen.has(w.jobType)) return false;
    seen.add(w.jobType);
    return true;
  });
}

export type TribeStat = 'absent' | 'cadence' | 'damage' | 'range' | 'weight';

/** One number that differs between a tribe and the reference. */
export interface TribeDifference {
  readonly subject: string;
  readonly stat: TribeStat;
  readonly reference: string | null;
  readonly own: string | null;
}

export interface BuildingDifference {
  readonly building: KnowledgeBuilding;
  readonly reference: number;
  readonly own: number;
}

export interface TribeDifferences {
  readonly stepSeconds: { readonly reference: string; readonly own: string } | null;
  readonly weapons: readonly TribeDifference[];
  readonly buildings: readonly BuildingDifference[];
}

/** A weapon's name in a table; the catapult's row names its stone as the good. */
export function weaponName(base: KnowledgeBase, weapon: KnowledgeWeapon): string {
  if (isCatapultWeapon(weapon)) {
    return base.vehicles.find((v) => v.jobType === weapon.jobType)?.name ?? weapon.id;
  }
  return weapon.goodName ?? weapon.jobName ?? weapon.id;
}

function weaponDifferences(
  base: KnowledgeBase,
  referenceRow: KnowledgeWeapon,
  own: KnowledgeWeapon,
): readonly TribeDifference[] {
  const bare = combatTargets(base)[0];
  const subject = weaponName(base, own);
  const pair = (stat: TribeStat, read: (row: KnowledgeWeapon) => string): readonly TribeDifference[] => {
    const before = read(referenceRow);
    const after = read(own);
    return before === after ? [] : [{ subject, stat, reference: before, own: after }];
  };
  return [
    ...pair('damage', (row) => (bare === undefined ? '' : wholeText(landed(row, bare)))),
    ...pair('cadence', cadenceText),
    ...pair('range', rangeText),
    ...pair('weight', (row) => String(row.weight)),
  ];
}

/** What sets `tribe` apart from `reference`, computed from their rows so nothing is authored. */
export function tribeDifferences(base: KnowledgeBase, tribe: number, reference: number): TribeDifferences {
  const theirs = tribeWeapons(base, reference);
  const ours = tribeWeapons(base, tribe);
  const byJob = (rows: readonly KnowledgeWeapon[], job: number | null): KnowledgeWeapon | undefined =>
    rows.find((row) => row.jobType === job);
  const weapons: TribeDifference[] = [];
  for (const row of ours) {
    const other = byJob(theirs, row.jobType);
    if (other === undefined) {
      weapons.push({ subject: weaponName(base, row), stat: 'absent', reference: null, own: '' });
    } else weapons.push(...weaponDifferences(base, other, row));
  }
  for (const row of theirs) {
    if (byJob(ours, row.jobType) === undefined) {
      weapons.push({ subject: weaponName(base, row), stat: 'absent', reference: '', own: null });
    }
  }
  const step = stepSeconds(base, 0, tribe);
  const referenceStep = stepSeconds(base, 0, reference);
  const buildings = base.buildings.flatMap((building): BuildingDifference[] => {
    const own = buildingHitpoints(building, tribe);
    const other = buildingHitpoints(building, reference);
    return own === null || other === null || own === other ? [] : [{ building, reference: other, own }];
  });
  return {
    stepSeconds:
      step === referenceStep
        ? null
        : { reference: preciseSecondsText(referenceStep), own: preciseSecondsText(step) },
    weapons,
    buildings,
  };
}
