import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_CIVILIST, JOB_WOMAN } from '../../catalog/jobs.js';
import { isSoldierJob, PROFESSIONS } from '../../catalog/professions.js';
import { SOLDIER_CLASS_OF_JOB } from '../../catalog/soldier-classes.js';
import { WEAPON_XP_KEY_BY_TYPE } from '../../catalog/weapon-experience.js';
import {
  authoredTribeNames,
  currentLocale,
  installNameOverlay,
  type Locale,
  type Messages,
  messages,
  type NameOverlay,
} from '../../i18n/index.js';
import { loadIr } from '../ir/load.js';
import { type GuiStrings, loadGuiStrings } from './gfx.js';

/** The content rows that turn a string table's type id into the slug a catalog keys the name by. The
 *  tables use the game's type ids, so these are the decoded content's rows, never the sandbox's. */
export type NameContent = Pick<ContentSet, 'goods' | 'buildings' | 'jobs' | 'jobExperience' | 'tribes'>;

/** Profession keys outside the picker roster, by the job they name. The other off-roster keys (the sea
 *  trades) equal their content job's slug. */
const OFF_ROSTER_PROFESSION_JOBS: Readonly<Partial<Record<keyof Messages['profession'], number>>> = {
  idle: JOB_CIVILIST,
  archer_short: JOB_ARCHER,
  archer_long: JOB_ARCHER_LONG,
};

/** The group panel's settler roles one job names. A child's role spans the baby and child jobs and a
 *  hero's is the generic hero class label, so both keep their authored text. */
const GROUP_ROLE_JOBS: ReadonlyMap<keyof Messages['hud']['groupPanel']['role'], number> = new Map([
  ['civilian', JOB_CIVILIST],
  ['woman', JOB_WOMAN],
]);

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

/** The content's own tribe names for the ids the locale catalogs do not translate: a pack's new people
 *  shows as its tribes row's name instead of a bare id, on every surface that reads the catalog. Only
 *  an array of rows counts - a stub or another build's document carries none. The ids are checked
 *  against the shipped catalog, never the installed overlay: an earlier install already names the pack's
 *  people, and skipping it would drop that name from the overlay that replaces it. */
function contentTribeNames(
  locale: Locale,
  tribes:
    | readonly {
        readonly typeId?: number;
        readonly name?: string | undefined;
      }[]
    | undefined,
): Record<number, string> {
  const out: Record<number, string> = {};
  if (!Array.isArray(tribes)) return out;
  for (const row of tribes) {
    if (row.typeId === undefined || row.name === undefined) continue;
    if (authoredTribeNames(locale)[row.typeId] !== undefined) continue;
    out[row.typeId] = row.name;
  }
  return out;
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
 * `experiences`, `tribes`, keyed by type id) give.
 */
export function originalNameOverlay(
  strings: GuiStrings,
  content: NameContent,
  locale: Locale = currentLocale(),
): NameOverlay {
  const { goods, houses, jobs, jobsPlural, experiences } = strings;
  const byTypeId = <T extends { readonly typeId: number }>(row: T): number => row.typeId;
  const bySlug = <T extends { readonly id: string }>(row: T): string => row.id;

  const jobOfKey = professionJobs(content);
  const rosterJobs = new Set(PROFESSIONS.map((p) => p.jobType));
  const heroJobs = content.jobs.filter((row) => systems.isHeroJobRow(row));
  // Only the classes a soldier can hold: the sabre and axe rows stay decoded but unnamed.
  const soldierJobs = content.jobs.filter((row) => SOLDIER_CLASS_OF_JOB.has(row.typeId));
  const roleJobs = content.jobs.filter(
    (row) => !rosterJobs.has(row.typeId) && !isSoldierJob(row.typeId) && !systems.isHeroJobRow(row),
  );

  return {
    goods: named(content.goods, goods, bySlug, byTypeId),
    building: named(content.buildings, houses, bySlug, byTypeId),
    profession: byKey(jobOfKey, jobs),
    professions: byKey(jobOfKey, jobsPlural),
    roleNames: named(roleJobs, jobs, bySlug, byTypeId),
    heroNames: named(heroJobs, jobs, bySlug, byTypeId),
    soldierClass: named(soldierJobs, jobs, bySlug, byTypeId),
    soldierClasses: named(soldierJobs, jobsPlural, bySlug, byTypeId),
    groupRole: byKey(GROUP_ROLE_JOBS, jobs),
    groupRoles: byKey(GROUP_ROLE_JOBS, jobsPlural),
    trackLabels: named(content.jobExperience, experiences, bySlug, byTypeId),
    weaponXp: named(
      [...WEAPON_XP_KEY_BY_TYPE],
      experiences,
      ([, key]) => key,
      ([type]) => type,
    ),
    tribeNames: { ...tribeNamesOf(strings), ...contentTribeNames(locale, content.tribes) },
  };
}

/** Show `locale`'s original game-object names on every surface that reads the catalog. */
export function installOriginalNames(locale: Locale, strings: GuiStrings, content: NameContent): void {
  installNameOverlay(locale, originalNameOverlay(strings, content, locale));
}

/**
 * `locale`'s original tribe names, which need no content rows, so every entry shows the same names
 * whether or not a world booted in this document; a world's {@link installOriginalNames} keeps them.
 * The served IR's own tribe rows name a pack's people, so their names join the overlay; without the
 * pipeline's strings it is still the content's names over the authored catalog.
 */
export async function originalTribeNameOverlay(locale: Locale): Promise<NameOverlay> {
  const [strings, ir] = await Promise.all([loadGuiStrings(locale), loadIr()]);
  // The pipeline's strings name the authored tribes; the content's rows name a pack's people beside
  // them. No name from either keeps the overlay empty, so the authored catalog stands.
  const names = {
    ...contentTribeNames(locale, ir?.tribes),
    ...(strings === null ? {} : tribeNamesOf(strings)),
  };
  return Object.keys(names).length === 0 ? {} : { tribeNames: names };
}

/** Name a pack's people from the content's tribe rows alone, for a world booted without the language's
 *  pipeline strings; the authored catalog names stand for every other id. */
export function installContentTribeNames(locale: Locale, content: Pick<NameContent, 'tribes'>): void {
  const names = contentTribeNames(locale, content.tribes);
  if (Object.keys(names).length > 0) installNameOverlay(locale, { tribeNames: names });
}

/** Show `locale`'s original tribe names, as a screen that picks a language installs them. */
export async function installOriginalTribeNames(locale: Locale): Promise<void> {
  installNameOverlay(locale, await originalTribeNameOverlay(locale));
}
