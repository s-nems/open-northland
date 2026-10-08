import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_CIVILIST } from '../catalog/jobs.js';
import { isSoldierJob, PROFESSIONS } from '../catalog/professions.js';
import { installNameOverlay, type Locale, type Messages, messages, type NameOverlay } from '../i18n/index.js';
import { type GuiStrings, loadGuiStrings } from './gui-gfx.js';

/** The content rows that turn a string table's type id into the slug a catalog keys the name by. The
 *  tables use the game's type ids, so these are the decoded content's rows, never the sandbox's. */
export type NameContent = Pick<ContentSet, 'goods' | 'buildings' | 'jobs' | 'jobExperience' | 'tribes'>;

type WeaponXpKey = keyof Messages['hud']['weaponXp'];

/** The fight experience buckets, which have no content row, by the catalog key that names them. */
export const WEAPON_XP_TYPES: Readonly<Record<WeaponXpKey, number>> = {
  fist: systems.FIGHT_EXPERIENCE_TYPE.FIST,
  spear: systems.FIGHT_EXPERIENCE_TYPE.SPEAR,
  sword: systems.FIGHT_EXPERIENCE_TYPE.SWORD,
  bow: systems.FIGHT_EXPERIENCE_TYPE.BOW,
  catapult: systems.FIGHT_EXPERIENCE_TYPE.CATAPULT,
};

/** Profession keys outside the picker roster, by the job they name. The other off-roster keys (the sea
 *  trades) equal their content job's slug. */
const OFF_ROSTER_PROFESSION_JOBS: Readonly<Partial<Record<keyof Messages['profession'], number>>> = {
  idle: JOB_CIVILIST,
  archer_short: JOB_ARCHER,
  archer_long: JOB_ARCHER_LONG,
};

type Table = Readonly<Record<string, string>>;

/** Each row's name from `table` under the key the catalog uses for it. A row the table lacks is left out,
 *  and so is a key more than one row shares (content repeats some job slugs), which keeps its authored
 *  text rather than whichever row came last. */
function named<T, K extends string | number>(
  rows: readonly T[],
  table: Table | undefined,
  key: (row: T) => K,
  typeId: (row: T) => number,
): Record<K, string> {
  const out = {} as Record<K, string>;
  if (table === undefined) return out;
  const shared = sharedKeys(rows, key);
  for (const row of rows) {
    const name = table[String(typeId(row))];
    if (name !== undefined && !shared.has(key(row))) out[key(row)] = name;
  }
  return out;
}

function sharedKeys<T, K>(rows: readonly T[], key: (row: T) => K): Set<K> {
  const seen = new Set<K>();
  const shared = new Set<K>();
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) shared.add(k);
    seen.add(k);
  }
  return shared;
}

/** The tribes table is keyed by tribe id, which is also the catalog's key, so it needs no content rows. */
function tribeNamesOf(strings: GuiStrings): Record<number, string> {
  return Object.fromEntries(Object.entries(strings.tribes ?? {}).map(([id, name]) => [Number(id), name]));
}

/** The job each profession key names: the picker roster, the off-roster keys, and every other authored
 *  key that equals a content job slug no other row shares. */
function professionJobs(content: NameContent): Map<string, number> {
  const jobOfKey = new Map<string, number>(PROFESSIONS.map((p) => [p.key, p.jobType]));
  for (const [key, job] of Object.entries(OFF_ROSTER_PROFESSION_JOBS)) jobOfKey.set(key, job);
  const authoredKeys = new Set(Object.keys(messages().profession));
  const shared = sharedKeys(content.jobs, (row) => row.id);
  for (const row of content.jobs) {
    if (authoredKeys.has(row.id) && !jobOfKey.has(row.id) && !shared.has(row.id)) {
      jobOfKey.set(row.id, row.typeId);
    }
  }
  return jobOfKey;
}

function byKey(jobOfKey: ReadonlyMap<string, number>, table: Table | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (table === undefined) return out;
  for (const [key, job] of jobOfKey) {
    const name = table[String(job)];
    if (name !== undefined) out[key] = name;
  }
  return out;
}

/**
 * The catalog overlay one language's game-object string tables (`goods`, `houses`, `jobs`, `jobsPlural`,
 * `experiences`, `tribes`, keyed by type id) give. A vehicle's build site takes the vehicle's good name,
 * since the houses table names both ship yards alike.
 */
export function originalNameOverlay(strings: GuiStrings, content: NameContent): NameOverlay {
  const { goods, houses, jobs, jobsPlural, experiences } = strings;
  const byTypeId = <T extends { readonly typeId: number }>(row: T): number => row.typeId;
  const bySlug = <T extends { readonly id: string }>(row: T): string => row.id;

  const building = named(content.buildings, houses, bySlug, byTypeId);
  for (const good of content.goods) {
    const site = content.buildings.find((row) => row.typeId === good.vehicleHouse);
    const name = goods?.[String(good.typeId)];
    if (site !== undefined && name !== undefined) building[site.id] = name;
  }

  const jobOfKey = professionJobs(content);
  const rosterJobs = new Set(PROFESSIONS.map((p) => p.jobType));
  const heroJobs = content.jobs.filter((row) => systems.isHeroJobRow(row));
  const soldierJobs = content.jobs.filter((row) => isSoldierJob(row.typeId));
  const roleJobs = content.jobs.filter(
    (row) => !rosterJobs.has(row.typeId) && !isSoldierJob(row.typeId) && !systems.isHeroJobRow(row),
  );

  return {
    goods: named(content.goods, goods, bySlug, byTypeId),
    building,
    profession: byKey(jobOfKey, jobs),
    professions: byKey(jobOfKey, jobsPlural),
    roleNames: named(roleJobs, jobs, bySlug, byTypeId),
    heroNames: named(heroJobs, jobs, bySlug, byTypeId),
    soldierClass: named(soldierJobs, jobs, bySlug, byTypeId),
    soldierClasses: named(soldierJobs, jobsPlural, bySlug, byTypeId),
    trackLabels: named(content.jobExperience, experiences, bySlug, byTypeId),
    weaponXp: named(
      Object.entries(WEAPON_XP_TYPES),
      experiences,
      ([key]) => key,
      ([, type]) => type,
    ),
    tribeNames: tribeNamesOf(strings),
  };
}

/** Show `locale`'s original game-object names on every surface that reads the catalog. */
export function installOriginalNames(locale: Locale, strings: GuiStrings, content: NameContent): void {
  installNameOverlay(locale, originalNameOverlay(strings, content));
}

/**
 * `locale`'s original tribe names, which need no content rows, so every entry shows the same names
 * whether or not a world booted in this document; a world's {@link installOriginalNames} keeps them.
 * Without the pipeline's strings it is empty and the authored catalog stays.
 */
export async function originalTribeNameOverlay(locale: Locale): Promise<NameOverlay> {
  const strings = await loadGuiStrings(locale);
  return strings === null ? {} : { tribeNames: tribeNamesOf(strings) };
}

/** Show `locale`'s original tribe names, as a screen that picks a language installs them. */
export async function installOriginalTribeNames(locale: Locale): Promise<void> {
  installNameOverlay(locale, await originalTribeNameOverlay(locale));
}
